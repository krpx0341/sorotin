#!/usr/bin/env python3
"""Scene-aware face analysis for a clip window; stdout JSON for ffmpeg reframing.

One sequential decode pass over [start, end]:
  * every frame -> tiny 64x36 signature -> hard-cut detection (frame accurate)
  * every --step seconds -> YuNet face detection (+ landmarks, sharpness, content rect)

Faces come from OpenCV's YuNet (`cv2.FaceDetectorYN`), which exists in OpenCV 4.5.4+
and in OpenCV 5. Haar `CascadeClassifier` is not used: OpenCV 5 moved it out of the
main package, and it missed large close-ups (headband, frame edge).

Output (times are relative to --start):
  cx, cy, confidence, samples, face_w, face_h, faces, speaker_count   (back-compat, whole clip)
  width, height                                                       (source pixels)
  segments: [{start, end, layout: single|dual|center, crops: [{x,y,w,h}], faces: [...]}]
            dual -> crops[0] = left face (top pane), crops[1] = right face (bottom pane)
  cover:    {t, segment, score} best cover moment (face, eyes open, sharp)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

try:
    import cv2
    import numpy as np
except ImportError as e:
    sys.stderr.write(
        "face_track: cannot import OpenCV (cv2) or numpy "
        f"({e}). Install with: pip install 'opencv-python-headless>=4.8,<6'\n"
    )
    raise SystemExit(1)

CUT_DIFF = 12.0  # mean abs diff of 64x36 BGR signature that counts as a hard cut
# Shots shorter than this merge into a neighbour. Crop changes only ever happen on a
# real cut (hard cut or inset-layout change), so a short shot can keep its own crop
# without visible jitter; merging 1–1.5s podcast reaction shots showed empty frames.
MIN_SEG = 0.6
# Shots shorter than this are never kept on their own (flash frames / dissolves).
MIN_SHOT = 0.2
# Two shots whose 64x36 signatures differ less than this are the same camera angle.
SAME_ANGLE_DIFF = 14.0
# A hard cut this close to the clip start/end means a flash of the neighbouring shot
# (often a single frame of another camera). Trim it off; at most 0.2s of audio.
EDGE_TRIM = 0.2

# YuNet (opencv_zoo, Apache-2.0). ~230 KB, bundled next to this script.
YUNET_FILENAME = "face_detection_yunet_2023mar.onnx"
YUNET_SCORE = 0.6
YUNET_NMS = 0.3
YUNET_TOPK = 5000
# Longest side passed to the network. Relative face size is unchanged by the scale.
DETECT_MAX_SIDE = 1280


def yunet_model_path() -> Path:
    override = os.environ.get("SOROTIN_YUNET_MODEL") or os.environ.get("PERSONAL_CLIPPER_YUNET_MODEL")
    if override:
        return Path(override)
    return Path(__file__).resolve().parent / "models" / YUNET_FILENAME


def face_detector_error(version: str, *, has_detector: bool, model: Path | None, detail: str = "") -> str:
    """Actionable startup error. Haar is intentionally not the fallback."""
    if not has_detector:
        return (
            f"OpenCV {version} has no cv2.FaceDetectorYN, so faces cannot be detected. "
            "Install a build that includes the YuNet face detector: "
            "pip install 'opencv-python-headless>=4.8,<6'. "
            "OpenCV 4 and OpenCV 5 both work. "
            "Haar CascadeClassifier is not used; OpenCV 5 moved it out of the main package."
        )
    if model is None or not model.is_file():
        where = model if model is not None else yunet_model_path()
        return (
            f"YuNet face model not found at {where}. "
            "Sorotin ships scripts/models/face_detection_yunet_2023mar.onnx "
            "(Apache-2.0, https://github.com/opencv/opencv_zoo). "
            "Restore that file or set SOROTIN_YUNET_MODEL to its path."
        )
    return (
        f"OpenCV {version} could not load the YuNet detector ({detail}). "
        "Reinstall with: pip install 'opencv-python-headless>=4.8,<6' (4.x or 5.x)."
    )


def _die(msg: str) -> None:
    print(f"face_track: {msg}", file=sys.stderr)
    raise SystemExit(1)


def _quiet_opencv() -> None:
    # OpenCV 5 prints a one-shot DNN graph warning on the default target. Detection
    # still works; keep stderr for our own messages.
    try:
        cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_ERROR)
    except Exception:
        pass


class YuNet:
    """cv2.FaceDetectorYN wrapper. Boxes are in the original frame's pixels."""

    def __init__(self, model: str):
        det = cv2.FaceDetectorYN.create(model, "", (320, 320), YUNET_SCORE, YUNET_NMS, YUNET_TOPK)
        if det is None:
            raise RuntimeError("FaceDetectorYN.create returned None")
        self.det = det
        self.size = (320, 320)

    def detect(self, bgr: np.ndarray) -> list[tuple[int, int, int, int, float, int]]:
        h, w = bgr.shape[:2]
        scale = 1.0
        work = bgr
        long_side = max(h, w)
        if long_side > DETECT_MAX_SIDE:
            scale = DETECT_MAX_SIDE / float(long_side)
            work = cv2.resize(
                bgr,
                (max(1, int(round(w * scale))), max(1, int(round(h * scale)))),
                interpolation=cv2.INTER_AREA,
            )
        ww, hh = int(work.shape[1]), int(work.shape[0])
        if (ww, hh) != self.size:
            self.det.setInputSize((ww, hh))
            self.size = (ww, hh)
        _ret, faces = self.det.detect(work)
        if faces is None or len(faces) == 0:
            return []
        inv = 1.0 / scale
        out: list[tuple[int, int, int, int, float, int]] = []
        for row in faces:
            x = int(round(float(row[0]) * inv))
            y = int(round(float(row[1]) * inv))
            fw = int(round(float(row[2]) * inv))
            fh = int(round(float(row[3]) * inv))
            score = float(row[14])
            x = max(0, min(x, w - 1))
            y = max(0, min(y, h - 1))
            fw = max(0, min(fw, w - x))
            fh = max(0, min(fh, h - y))
            if fw < 12 or fh < 12:
                continue
            eyes = 0
            for i in (0, 1):
                ex = float(row[4 + 2 * i]) * inv
                ey = float(row[5 + 2 * i]) * inv
                if x - 0.25 * fw <= ex <= x + 1.25 * fw and y - 0.3 * fh <= ey <= y + 0.8 * fh:
                    eyes += 1
            out.append((x, y, fw, fh, score, eyes))
        out.sort(key=lambda b: b[4], reverse=True)
        return out


def load_yunet() -> YuNet:
    """Fail before any frame is read when this OpenCV build cannot detect faces."""
    _quiet_opencv()
    version = getattr(cv2, "__version__", "unknown")
    if not hasattr(cv2, "FaceDetectorYN"):
        _die(face_detector_error(version, has_detector=False, model=None))
    model = yunet_model_path()
    if not model.is_file() or model.stat().st_size < 1000:
        _die(face_detector_error(version, has_detector=True, model=model))
    try:
        return YuNet(str(model))
    except Exception as e:
        _die(face_detector_error(version, has_detector=True, model=model, detail=f"{type(e).__name__}: {e}"))
    raise AssertionError("unreachable")


# ---------------------------------------------------------------- detection

def _iou_px(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ix = max(0, min(ax + aw, bx + bw) - max(ax, bx))
    iy = max(0, min(ay + ah, by + bh) - max(ay, by))
    inter = ix * iy
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def content_rect(frame: np.ndarray) -> tuple[float, float, float, float] | None:
    """Bounding box of content placed on a solid-colour background (video inset).

    Returns normalized (x0, y0, x1, y1) or None when the frame is full-bleed.
    """
    small = cv2.resize(frame, (160, 90), interpolation=cv2.INTER_AREA).astype(np.int16)
    sides = [small[:3].reshape(-1, 3), small[-3:].reshape(-1, 3), small[:, :3].reshape(-1, 3), small[:, -3:].reshape(-1, 3)]
    med = np.median(np.concatenate(sides), axis=0)
    # Content may touch some edges (e.g. inset + document reaching top/bottom);
    # require >= 2 sides that are almost entirely the background colour.
    solid = [float(np.mean(np.all(np.abs(sd - med) <= 18, axis=1))) for sd in sides]
    if sum(1 for f in solid if f >= 0.9) < 2 or float(np.mean(solid)) < 0.55:
        return None
    diff = np.max(np.abs(small - med), axis=2) > 30
    rows = np.where(diff.mean(axis=1) > 0.12)[0]
    cols = np.where(diff.mean(axis=0) > 0.12)[0]
    if not len(rows) or not len(cols):
        return None
    x0, x1 = cols[0] / 160.0, (cols[-1] + 1) / 160.0
    y0, y1 = rows[0] / 90.0, (rows[-1] + 1) / 90.0
    area = (x1 - x0) * (y1 - y0)
    if area < 0.12 or area > 0.92:
        return None
    return (x0, y0, x1, y1)


def skin_fraction(bgr_roi: np.ndarray) -> float:
    """Share of skin-tone pixels (YCrCb box, robust across skin tones/lighting)."""
    if bgr_roi.size == 0:
        return 0.0
    ycc = cv2.cvtColor(bgr_roi, cv2.COLOR_BGR2YCrCb)
    cr, cb = ycc[:, :, 1], ycc[:, :, 2]
    mask = (cr >= 133) & (cr <= 180) & (cb >= 75) & (cb <= 130)
    return float(mask.mean())


MIN_SKIN = 0.5  # posters/figurines sit under this; real faces measure ~0.8–1.0


@dataclass
class Sample:
    t: float
    boxes: list[tuple[float, float, float, float]]  # normalized (cx, cy, fw, fh)
    eyes: list[int]  # eyes found per box
    sharp: float
    rect: tuple[float, float, float, float] | None
    sig: np.ndarray | None = None  # 64x36 BGR signature (same-angle matching)


def _same_face(a: tuple[int, int, int, int], b: tuple[int, int, int, int], w: int, h: int) -> bool:
    """YuNet sometimes emits a second, shifted box on the same head (headband, close-up)."""
    if _iou_px(a, b) > 0.2:
        return True
    acx, acy = (a[0] + a[2] / 2) / w, (a[1] + a[3] / 2) / h
    bcx, bcy = (b[0] + b[2] / 2) / w, (b[1] + b[3] / 2) / h
    return abs(acx - bcx) < 0.12 and abs(acy - bcy) < 0.22


def analyze(frame: np.ndarray, t: float, detector: YuNet | None) -> Sample:
    h, w = frame.shape[:2]
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    raw = detector.detect(frame) if detector is not None else []
    boxes: list[tuple[float, float, float, float]] = []
    px: list[tuple[int, int, int, int]] = []
    eyes: list[int] = []
    # Highest score first (YuNet.detect already sorts). A later duplicate is dropped.
    for x, y, fw, fh, score, eye_n in raw:
        # central 60% of the box (skips hair/background at the edges)
        roi = frame[y + int(fh * 0.2): y + int(fh * 0.8), x + int(fw * 0.2): x + int(fw * 0.8)]
        # A very confident box can sit a bit under the poster threshold (headband,
        # strong colour cast) and still be a face. Low scores still need real skin.
        need = 0.28 if score >= 0.85 else MIN_SKIN
        if skin_fraction(roi) < need:
            continue
        box = (x, y, fw, fh)
        if any(_same_face(box, prev, w, h) for prev in px):
            continue
        cx = (x + fw / 2.0) / w
        cy = (y + fh * 0.42) / h
        boxes.append((cx, cy, fw / w, fh / h))
        px.append(box)
        eyes.append(min(2, eye_n))
    sharp_rois = []
    for x, y, fw, fh in px:
        roi = gray[max(0, y): y + fh, max(0, x): x + fw]
        sharp_rois.append(roi)
    if sharp_rois:
        sharp = float(np.mean([cv2.Laplacian(r, cv2.CV_64F).var() for r in sharp_rois if r.size]))
    else:
        sharp = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    sig = cv2.resize(frame, (64, 36), interpolation=cv2.INTER_AREA).astype(np.int16)
    return Sample(t=t, boxes=boxes, eyes=eyes, sharp=sharp, rect=content_rect(frame), sig=sig)


# ---------------------------------------------------------------- clustering

def nms_by_x(boxes, min_sep: float = 0.18):
    ordered = sorted(boxes, key=lambda b: b[2] * b[3], reverse=True)
    kept = []
    for b in ordered:
        if any(abs(b[0] - k[0]) < min_sep for k in kept):
            continue
        kept.append(b)
        if len(kept) >= 2:
            break
    return kept


def _med(vals) -> dict:
    a = np.array(vals)
    return {"cx": float(np.median(a[:, 0])), "cy": float(np.median(a[:, 1])),
            "face_w": float(np.median(a[:, 2])), "face_h": float(np.median(a[:, 3]))}


def cluster_speakers(per_frame, strict: bool = False) -> tuple[list[dict], int]:
    """Cluster detections across frames into 1–2 speakers (left→right).

    strict=True (per scene segment) requires the second face in a larger share of samples.
    """
    frames = [f for f in per_frame if f]
    if not frames:
        return [], 0
    primary = [max(f, key=lambda b: b[2] * b[3]) for f in frames]
    left, right = [], []
    for f in frames:
        d = nms_by_x(f)
        if len(d) >= 2:
            a, b = sorted(d[:2], key=lambda x: x[0])
            left.append(a)
            right.append(b)
    dual_frames = len(left)
    if not strict and dual_frames < 3 and len(primary) >= 4:
        xs = np.array([p[0] for p in primary])
        lo, hi = float(np.percentile(xs, 25)), float(np.percentile(xs, 75))
        if hi - lo >= 0.18:
            li = [p for p in primary if abs(p[0] - lo) <= abs(p[0] - hi)]
            ri = [p for p in primary if abs(p[0] - hi) < abs(p[0] - lo)]
            if len(li) >= 3 and len(ri) >= 3:
                left, right, dual_frames = li, ri, min(len(li), len(ri))
    ratio = dual_frames / max(1, len(frames))
    dual_ok = (dual_frames >= 2 and ratio >= 0.4) if strict else (dual_frames >= 3 or ratio >= 0.30)
    if dual_ok and left and right:
        faces = sorted([_med(left), _med(right)], key=lambda f: f["cx"])
        hs = sorted(f["face_h"] for f in faces)
        # Two real people in one shot are similar in size; a much smaller "face"
        # is usually a poster/toy/background false positive.
        if faces[1]["cx"] - faces[0]["cx"] >= 0.15 and hs[0] >= 0.55 * hs[1]:
            return faces, 2
    return [_med(primary)], 1


# ---------------------------------------------------------------- segments

def split_segments(cuts: list[float], duration: float, min_len: float = MIN_SEG) -> list[list[float]]:
    """Turn cut times into [start, end] segments; merge ones shorter than min_len.

    main() calls this with min_len=MIN_SHOT so short real shots keep their own span;
    resolve_shots() then decides which crop a short / face-less shot borrows.
    """
    bounds = [0.0] + sorted(c for c in cuts if 0.0 < c < duration) + [duration]
    segs = [[bounds[i], bounds[i + 1]] for i in range(len(bounds) - 1) if bounds[i + 1] > bounds[i]]
    while len(segs) > 1:
        i = min(range(len(segs)), key=lambda k: segs[k][1] - segs[k][0])
        if segs[i][1] - segs[i][0] >= min_len:
            break
        if i == 0:
            j = 1
        elif i == len(segs) - 1:
            j = i - 1
        else:  # merge into the longer neighbour
            j = i - 1 if (segs[i - 1][1] - segs[i - 1][0]) >= (segs[i + 1][1] - segs[i + 1][0]) else i + 1
        a, b = min(i, j), max(i, j)
        segs[a:b + 1] = [[segs[a][0], segs[b][1]]]
    return segs


def rect_iou(a, b) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def layout_cuts(samples: list[Sample], diffs: list[tuple[float, float]], cuts: list[float]) -> list[float]:
    """Extra cuts where the inset layout moves/appears without a hard cut (slides, zooms).

    The cut is placed on the frame with the largest signature change between the two samples.
    """
    out: list[float] = []
    for a, b in zip(samples, samples[1:]):
        if any(a.t < c <= b.t for c in cuts):
            continue
        ra, rb = a.rect, b.rect
        changed = (ra is None) != (rb is None) or (ra is not None and rb is not None and rect_iou(ra, rb) < 0.8)
        if not changed:
            continue
        window = [d for d in diffs if a.t < d[0] <= b.t]
        out.append(max(window, key=lambda d: d[1])[0] if window else b.t)
    return out


def inside_frac(crop: dict, rect, W: int, H: int) -> float:
    if rect is None:
        return 1.0
    x0, y0, x1, y1 = rect[0] * W, rect[1] * H, rect[2] * W, rect[3] * H
    ix = max(0.0, min(crop["x"] + crop["w"], x1) - max(crop["x"], x0))
    iy = max(0.0, min(crop["y"] + crop["h"], y1) - max(crop["y"], y0))
    return ix * iy / max(1.0, crop["w"] * crop["h"])


def _even(v: float) -> int:
    return int(round(v / 2.0)) * 2


def _clamp_origin(v: float, size: float, lo: float, hi: float, full: float) -> float:
    if size <= hi - lo:
        v = min(max(v, lo), hi - size)
    return min(max(v, 0.0), full - size)


def _clamped_crop(x: float, y: float, cw: float, ch: float, bx0: float, by0: float, bx1: float, by1: float,
                  W: int, H: int) -> dict:
    """Previous behaviour: slide the window inside the frame. Integers match the Haar crops."""
    x = _clamp_origin(x, cw, bx0, bx1, W)
    y = _clamp_origin(y, ch, by0, by1, H)
    cw_i, ch_i = min(_even(cw), W - W % 2), min(_even(ch), H - H % 2)
    x_i = max(0, min(_even(x), W - cw_i))
    y_i = max(0, min(_even(y), H - ch_i))
    return {"x": x_i, "y": y_i, "w": cw_i, "h": ch_i}


def pane_crop(face: dict | None, W: int, H: int, aspect: float, target_frac: float,
              min_h_frac: float, headroom: float, rect) -> dict:
    """Crop rect (source px) with output aspect `aspect` (w/h).

    Zoom so the face is ~target_frac of crop height (never tighter than min_h_frac*H),
    shrink to the content inset when it sits on a solid background, then clamp.

    When the window is narrower than the frame and the face sits on the edge, clamping
    shoves the face off-centre. In that case x/y/w/h stay the in-frame slice and
    place_* says where that slice sits in the output pane (the rest is a blurred fill).
    A full-bleed axis (the usual 9:16 crop is as tall as a 16:9 source) is still clamped,
    so centred shots keep the same crop integers as before.
    """
    max_h = min(H, W / aspect)
    min_h = min(max_h, min_h_frac * H)
    ch = max_h if face is None else face["face_h"] * H / target_frac
    bx0, by0, bx1, by1 = 0.0, 0.0, float(W), float(H)
    if rect is not None:
        bx0, by0, bx1, by1 = rect[0] * W, rect[1] * H, rect[2] * W, rect[3] * H
        ch = min(ch, (by1 - by0), (bx1 - bx0) / aspect)
    ch = max(min_h, min(max_h, ch))
    cw = ch * aspect
    if face is None:
        cx, cy = (bx0 + bx1) / 2.0, (by0 + by1) / 2.0
        x, y = cx - cw / 2.0, cy - ch / 2.0
    else:
        x = face["cx"] * W - cw / 2.0
        y = face["cy"] * H - ch * headroom

    span_w, span_h = bx1 - bx0, by1 - by0
    overhang_x = max(0.0, bx0 - x) + max(0.0, x + cw - bx1)
    overhang_y = max(0.0, by0 - y) + max(0.0, y + ch - by1)
    pad_x = cw < span_w - 1 and overhang_x >= 8
    pad_y = ch < span_h - 1 and overhang_y >= 8
    # Insets stay clamped inside the content rect. Blur-fill is only for a face
    # hanging off the real frame edge (the 9:16 window can't slide any further).
    if rect is not None or not (pad_x or pad_y):
        return _clamped_crop(x, y, cw, ch, bx0, by0, bx1, by1, W, H)

    ideal_x, ideal_y = x, y
    if not pad_x:
        ideal_x = _clamp_origin(x, cw, bx0, bx1, W)
    if not pad_y:
        ideal_y = _clamp_origin(y, ch, by0, by1, H)
    vis_x0 = 0.0 if not pad_x else min(max(ideal_x, 0.0), float(W))
    vis_y0 = 0.0 if not pad_y else min(max(ideal_y, 0.0), float(H))
    vis_x1 = float(W) if not pad_x else min(max(ideal_x + cw, 0.0), float(W))
    vis_y1 = float(H) if not pad_y else min(max(ideal_y + ch, 0.0), float(H))
    if not pad_x:
        vis_x0, vis_x1 = ideal_x, ideal_x + cw
    if not pad_y:
        vis_y0, vis_y1 = ideal_y, ideal_y + ch
    x_i = max(0, min(_even(vis_x0), max(0, W - 2)))
    y_i = max(0, min(_even(vis_y0), max(0, H - 2)))
    w_i = _even(max(0.0, vis_x1 - vis_x0))
    h_i = _even(max(0.0, vis_y1 - vis_y0))
    if x_i + w_i > W:
        w_i = _even(max(0, W - x_i))
    if y_i + h_i > H:
        h_i = _even(max(0, H - y_i))
    w_i = max(0, min(w_i, W - x_i))
    h_i = max(0, min(h_i, H - y_i))
    w_i -= w_i % 2
    h_i -= h_i % 2
    if w_i < 16 or h_i < 16:
        return _clamped_crop(x, y, cw, ch, bx0, by0, bx1, by1, W, H)

    if pad_x:
        place_x = (x_i - ideal_x) / cw
        place_w = w_i / cw
    else:
        place_x, place_w = 0.0, 1.0
    if pad_y:
        place_y = (y_i - ideal_y) / ch
        place_h = h_i / ch
    else:
        place_y, place_h = 0.0, 1.0
    place_x = min(1.0, max(0.0, place_x))
    place_y = min(1.0, max(0.0, place_y))
    place_w = min(1.0, max(0.05, place_w))
    place_h = min(1.0, max(0.05, place_h))
    crop = {"x": x_i, "y": y_i, "w": int(w_i), "h": int(h_i)}
    if place_w < 0.985 or place_h < 0.985 or place_x > 0.015 or place_y > 0.015:
        crop["place_x"] = round(place_x, 4)
        crop["place_y"] = round(place_y, 4)
        crop["place_w"] = round(place_w, 4)
        crop["place_h"] = round(place_h, 4)
    return crop


def median_rect(samples: list[Sample]):
    rects = [s.rect for s in samples if s.rect is not None]
    if not samples or len(rects) < max(1, int(0.6 * len(samples))):
        return None
    a = np.array(rects)
    return tuple(float(v) for v in np.median(a, axis=0))


def _map_span(src0: float, src1: float, origin: float, size: float, p0: float, psize: float) -> tuple[float, float]:
    """Map a source span through a visible crop onto the output pane (place_*)."""
    if size <= 0:
        return p0, p0
    return p0 + (src0 - origin) / size * psize, p0 + (src1 - origin) / size * psize


def face_boxes_out(faces: list[dict], crops: list[dict], W: int, H: int, dual: bool) -> list[dict]:
    """Face boxes in *output* frame coords (0..1), after crop/scale (+ vstack for dual).

    Detector boxes cover brow→chin, so the box is grown upward for hair/caps.
    place_* (set when the crop is padded) puts that slice inside the pane.
    """
    out = []
    for i, (f, c) in enumerate(zip(faces, crops)):
        fw, fh = f["face_w"] * W, f["face_h"] * H
        x0 = f["cx"] * W - fw / 2.0
        y0 = f["cy"] * H - 0.42 * fh - 0.35 * fh
        x1 = x0 + fw
        y1 = f["cy"] * H + 0.58 * fh + 0.10 * fh
        px0 = float(c.get("place_x", 0.0))
        py0 = float(c.get("place_y", 0.0))
        pw = float(c.get("place_w", 1.0))
        ph = float(c.get("place_h", 1.0))
        nx0, nx1 = _map_span(x0, x1, c["x"], c["w"], px0, pw)
        ny0, ny1 = _map_span(y0, y1, c["y"], c["h"], py0, ph)
        nx0, nx1 = max(0.0, nx0), min(1.0, nx1)
        ny0, ny1 = max(0.0, ny0), min(1.0, ny1)
        if nx1 <= nx0 or ny1 <= ny0:
            continue
        if dual:
            ny0, ny1 = (i + ny0) / 2.0, (i + ny1) / 2.0
        # core = brow→chin (no hair/cap growth): captions must never touch this
        cy0, cy1 = _map_span(f["cy"] * H - 0.42 * fh, f["cy"] * H + 0.58 * fh, c["y"], c["h"], py0, ph)
        cy0, cy1 = max(0.0, cy0), min(1.0, cy1)
        if dual:
            cy0, cy1 = (i + cy0) / 2.0, (i + cy1) / 2.0
        out.append({"x0": round(nx0, 4), "y0": round(ny0, 4), "x1": round(nx1, 4), "y1": round(ny1, 4),
                    "core_y0": round(cy0, 4), "core_y1": round(cy1, 4)})
    return out


def plan_segment(samples: list[Sample], W: int, H: int, out_w: int, out_h: int, allow_dual: bool) -> dict:
    rect = median_rect(samples)
    faces, n = cluster_speakers([s.boxes for s in samples], strict=True)
    if allow_dual and n == 2:
        half_aspect = out_w / (out_h / 2.0)
        crops = [pane_crop(f, W, H, half_aspect, 0.48, 0.5, 0.36, rect) for f in faces]
        # Inset too small for two readable halves -> one face instead of mostly-background panes
        if min(inside_frac(c, rect, W, H) for c in crops) >= 0.8:
            return {"layout": "dual", "crops": crops, "faces": faces,
                    "face_boxes": face_boxes_out(faces, crops, W, H, True)}
    aspect = out_w / out_h
    with_face = sum(1 for s in samples if s.boxes)
    if faces and with_face < max(1, 0.3 * len(samples)):
        faces = []  # sporadic detections only → don't steer the crop with them
    if faces:
        f = max(faces, key=lambda f: f["face_w"] * f["face_h"])
        crops = [pane_crop(f, W, H, aspect, 0.28, 0.75, 0.30, rect)]
        return {"layout": "single", "crops": crops, "faces": [f], "face_boxes": face_boxes_out([f], crops, W, H, False)}
    return {"layout": "center", "crops": [pane_crop(None, W, H, aspect, 0.28, 0.75, 0.30, rect)], "faces": [],
            "face_boxes": []}


def angle_diff(a: list[Sample], b: list[Sample]) -> float:
    """Smallest signature distance between two shots (same camera angle -> small)."""
    best = float("inf")
    for x in a:
        if x.sig is None:
            continue
        for y in b:
            if y.sig is not None:
                best = min(best, float(np.abs(x.sig - y.sig).mean()))
    return best


def reliable_face(seg: dict, min_len: float = MIN_SEG) -> bool:
    """A shot whose face plan we trust: has a face and enough time/samples behind it."""
    if seg["layout"] == "center" or not seg["faces"]:
        return False
    n = len(seg["_samples"])
    hits = sum(1 for s in seg["_samples"] if s.boxes)
    return (seg["end"] - seg["start"]) >= min_len and hits >= 2 and hits >= 0.4 * n


def resolve_shots(segs: list[dict], min_len: float = MIN_SEG) -> list[dict]:
    """Give short or face-less shots a crop that is actually on a face.

    * A face-less shot, or a short one (< min_len, its 1–2 face samples are not to be
      trusted: a figurine or poster fires Haar easily), borrows the plan of the most
      similar reliable shot of the *same camera angle* anywhere in the clip.
    * A short shot with no same-angle match keeps its own face plan if it has one;
      otherwise it inherits the next reliable shot (the previous one at clip end),
      the same behaviour as merging, but without stretching a wrong crop over it.
    """
    good = [i for i, s in enumerate(segs) if reliable_face(s, min_len)]
    if not good:
        return segs
    out = []
    for i, seg in enumerate(segs):
        short = (seg["end"] - seg["start"]) < min_len
        if i in good or (not short and seg["layout"] != "center"):
            out.append(seg)
            continue
        src = None
        scored = sorted((angle_diff(seg["_samples"], segs[j]["_samples"]), j) for j in good if j != i)
        if scored and scored[0][0] <= SAME_ANGLE_DIFF:
            src = segs[scored[0][1]]
        elif short and seg["layout"] != "center":
            src = None  # own face plan; no same-angle shot to trust instead
        elif short:
            nxt = [j for j in good if j > i]
            src = segs[nxt[0]] if nxt else segs[[j for j in good if j < i][-1]]
        if src is not None:
            seg = {**seg, **{k: src[k] for k in ("layout", "crops", "faces", "face_boxes")},
                   "borrowed": True}
        out.append(seg)
    return out


def cover_score(s: Sample, seg: dict, max_sharp: float) -> float:
    if not s.boxes:
        return -1.0
    want = max(1, len(seg["faces"]))
    # Match sample faces to the segment's planned faces (nearest cx)
    eyes, sizes, hits = [], [], 0
    for f in seg["faces"] or [None]:
        if f is None:
            i = max(range(len(s.boxes)), key=lambda k: s.boxes[k][2] * s.boxes[k][3])
        else:
            i = min(range(len(s.boxes)), key=lambda k: abs(s.boxes[k][0] - f["cx"]))
            if abs(s.boxes[i][0] - f["cx"]) > 0.12:
                continue
        hits += 1
        eyes.append(s.eyes[i] / 2.0)
        sizes.append(s.boxes[i][3])
    if not hits:
        return -1.0
    presence = hits / want
    eye = float(np.mean(eyes)) if eyes else 0.0
    sharp = s.sharp / max_sharp if max_sharp > 0 else 0.0
    size = min(1.0, float(np.mean(sizes)) / 0.35)
    return 1.6 * eye + 1.0 * presence + 0.9 * sharp + 0.4 * size


# ---------------------------------------------------------------- main

def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("media")
    p.add_argument("--start", type=float, default=0.0)
    p.add_argument("--end", type=float, default=0.0)
    p.add_argument("--step", type=float, default=0.5)
    p.add_argument("--out-w", type=int, default=1080)
    p.add_argument("--out-h", type=int, default=1920)
    p.add_argument("--allow-dual", action="store_true")
    args = p.parse_args()
    # OpenCV version + detector, before the file check, so a bad install is not an AttributeError.
    detector = load_yunet()

    media = Path(args.media)
    if not media.exists():
        print(json.dumps({"error": f"missing media: {media}"}), file=sys.stderr)
        return 1
    cap = cv2.VideoCapture(str(media))
    if not cap.isOpened():
        print(json.dumps({"error": "cannot open media"}), file=sys.stderr)
        return 1

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
    total = frame_count / fps if fps > 0 else 0.0
    start = max(0.0, args.start)
    end = args.end if args.end > start else total
    end = min(end, total) if total > 0 else end
    duration = max(0.0, end - start)

    # Single sequential pass (seeking per sample is very slow on AV1/VP9).
    cap.set(cv2.CAP_PROP_POS_MSEC, start * 1000.0)
    samples: list[Sample] = []
    cuts: list[float] = []
    diffs: list[tuple[float, float]] = []
    prev_sig = None
    next_t = 0.0
    W = H = 0
    while True:
        if not cap.grab():
            break
        t = (cap.get(cv2.CAP_PROP_POS_MSEC) or 0.0) / 1000.0 - start
        if t > duration + 1e-6:
            break
        ok, frame = cap.retrieve()
        if not ok or frame is None:
            continue
        H, W = frame.shape[:2]
        sig = cv2.resize(frame, (64, 36), interpolation=cv2.INTER_AREA).astype(np.int16)
        diff = float(np.abs(sig - prev_sig).mean()) if prev_sig is not None else 0.0
        diffs.append((max(0.0, t), diff))
        cut_here = diff > CUT_DIFF
        prev_sig = sig
        if cut_here and t > 0.0:
            cuts.append(max(0.0, t))
            next_t = min(next_t, t)  # sample the first frame of every new shot
        if t + 1e-6 >= next_t:
            samples.append(analyze(frame, max(0.0, t), detector))
            next_t = max(next_t + args.step, t + args.step * 0.5)
    cap.release()

    if not W or not samples:
        print(json.dumps({"cx": 0.5, "cy": 0.38, "confidence": 0.0, "samples": 0, "face_w": 0.2,
                          "face_h": 0.25, "faces": [], "speaker_count": 1, "segments": []}))
        return 0

    # --- trim flash frames of the previous/next shot at the clip edges
    trim_start = trim_end = 0.0
    if cuts and cuts[0] <= EDGE_TRIM and duration - cuts[0] > 2.0:
        trim_start = cuts[0]
        keep = [s for s in samples if s.t >= trim_start - 1e-6]
        if keep:
            samples = keep
            for smp in samples:
                smp.t = max(0.0, smp.t - trim_start)
            cuts = [c - trim_start for c in cuts[1:]]
            diffs = [(t - trim_start, d) for t, d in diffs if t > trim_start]
            duration -= trim_start
        else:
            trim_start = 0.0
    if cuts and duration - cuts[-1] <= EDGE_TRIM and cuts[-1] > 2.0:
        trim_end = duration - cuts[-1]
        duration = cuts[-1]
        samples = [s for s in samples if s.t < duration] or samples
        diffs = [(t, d) for t, d in diffs if t < duration]
        cuts = cuts[:-1]

    cuts = sorted(set(cuts + layout_cuts(samples, diffs, cuts)))

    # --- whole-clip summary (back-compat)
    faces, speaker_count = cluster_speakers([s.boxes for s in samples])
    with_face = sum(1 for s in samples if s.boxes)
    expected = max(1.0, duration / max(0.1, args.step))
    primary = max(faces, key=lambda f: f["face_w"] * f["face_h"]) if faces else \
        {"cx": 0.5, "cy": 0.38, "face_w": 0.2, "face_h": 0.25}

    # --- per-scene plan
    segs = []
    for a, b in split_segments(cuts, duration, MIN_SHOT):
        inside = [s for s in samples if a - 1e-6 <= s.t < b - 1e-6] or \
            [min(samples, key=lambda s: abs(s.t - (a + b) / 2))]
        plan = plan_segment(inside, W, H, args.out_w, args.out_h, args.allow_dual)
        segs.append({"start": round(a, 3), "end": round(b, 3), **plan, "_samples": inside})
    segs = resolve_shots(segs)
    # merge neighbours with identical layout and near-identical crops (fewer seams)
    merged = [segs[0]]
    for s in segs[1:]:
        m = merged[-1]
        same = m["layout"] == s["layout"] and all(
            abs(c1["x"] - c2["x"]) <= 0.03 * W and abs(c1["y"] - c2["y"]) <= 0.03 * H and abs(c1["h"] - c2["h"]) <= 0.05 * H
            for c1, c2 in zip(m["crops"], s["crops"]))
        if same:
            # keep the plan of the longer one, extend time span
            if s["end"] - s["start"] > m["end"] - m["start"]:
                m.update({k: s[k] for k in ("layout", "crops", "faces", "face_boxes")})
            m["end"] = s["end"]
            m["_samples"] = m["_samples"] + s["_samples"]
        else:
            merged.append(s)
    segs = merged

    # --- best cover moment
    max_sharp = max((s.sharp for s in samples if s.boxes), default=0.0)
    best = None
    for i, seg in enumerate(segs):
        seg_len = seg["end"] - seg["start"]
        for s in seg["_samples"]:
            if s.t < min(0.5, duration * 0.1) or s.t > duration - 0.5:
                continue
            if seg_len > 1.2 and (s.t - seg["start"] < 0.35 or seg["end"] - s.t < 0.35):
                continue  # avoid transition frames
            sc = cover_score(s, seg, max_sharp)
            if sc < 0:
                continue
            sc += 0.3 * min(1.0, seg_len / max(1.0, duration))
            if best is None or sc > best["score"]:
                best = {"t": round(s.t, 3), "segment": i, "score": round(sc, 3)}
    if best is None:
        best = {"t": round(min(2.0, duration / 3), 3), "segment": 0, "score": 0.0}
        for i, seg in enumerate(segs):
            if seg["start"] <= best["t"] < seg["end"]:
                best["segment"] = i

    for seg in segs:
        seg.pop("_samples", None)
        seg.pop("borrowed", None)
    print(json.dumps({
        "cx": primary["cx"], "cy": primary["cy"],
        "confidence": min(1.0, with_face / expected), "samples": with_face,
        "sample_count": len(samples),
        "face_w": primary["face_w"], "face_h": primary["face_h"],
        "faces": faces, "speaker_count": speaker_count,
        "detector": "yunet", "opencv": cv2.__version__,
        "width": W, "height": H, "duration": round(duration, 3),
        "trim_start": round(trim_start, 3), "trim_end": round(trim_end, 3),
        "cuts": [round(c, 3) for c in cuts],
        "segments": segs, "cover": best,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
