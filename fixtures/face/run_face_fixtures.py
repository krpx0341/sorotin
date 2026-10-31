#!/usr/bin/env python3
"""Run scripts/face_track.py on the face fixtures and print a pass/fail table.

Videos are not in the repo. Point FIXTURE_DIR at a directory of rebuilt mp4s
(see manifest.json for the Wikimedia source and the ffmpeg command). ours.mp4
is optional and local-only: set OURS_MP4. Do not commit that file or frames from it.

    FIXTURE_DIR=/tmp/face-fixtures OURS_MP4=/path/ours.mp4 \\
      python3 fixtures/face/run_face_fixtures.py --crops /tmp/face-crops
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = Path(__file__).resolve().parent / "manifest.json"
FACE_TRACK = ROOT / "scripts" / "face_track.py"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def find_video(fx: dict, fixture_dir: Path) -> Path | None:
    if fx.get("optional") and fx.get("env_path"):
        env = os.environ.get(fx["env_path"])
        return Path(env) if env else None
    candidate = fixture_dir / fx["file"]
    return candidate if candidate.is_file() else None


def output_cx(face: dict, crop: dict, width: int) -> float:
    place_x = float(crop.get("place_x", 0.0))
    place_w = float(crop.get("place_w", 1.0))
    return place_x + (face["cx"] * width - crop["x"]) / crop["w"] * place_w


def hit_rate(data: dict) -> float:
    total = int(data.get("sample_count") or 0)
    if total <= 0:
        return 0.0
    return float(data.get("samples") or 0) / total


def check(fx: dict, data: dict) -> list[str]:
    exp = fx.get("expected") or {}
    problems: list[str] = []
    faces = data.get("faces") or []
    want_n = exp.get("faces")
    if want_n is not None and len(faces) != want_n:
        problems.append(f"faces {len(faces)} != {want_n}")
    rate = hit_rate(data)
    if exp.get("min_hit_rate") is not None and rate + 1e-9 < float(exp["min_hit_rate"]):
        problems.append(f"hit_rate {rate:.2f} < {exp['min_hit_rate']}")
    cx_spec = exp.get("face_cx")
    if cx_spec and faces:
        got = sorted(float(f["cx"]) for f in faces)
        if isinstance(cx_spec[0], list):
            if len(got) != len(cx_spec):
                problems.append(f"cx count {len(got)} != {len(cx_spec)}")
            else:
                for i, (lo, hi) in enumerate(cx_spec):
                    if not (lo - 1e-6 <= got[i] <= hi + 1e-6):
                        problems.append(f"face[{i}] cx {got[i]:.3f} not in {lo}-{hi}")
        else:
            cx = got[0]
            if not (cx_spec[0] - 1e-6 <= cx <= cx_spec[1] + 1e-6):
                problems.append(f"cx {cx:.3f} not in {cx_spec[0]}-{cx_spec[1]}")
    layout = str(exp.get("layout") or "")
    segs = data.get("segments") or []
    if "dual" in layout:
        if not any(s.get("layout") == "dual" for s in segs):
            problems.append("layout is not dual")
    elif layout.startswith("single"):
        if not segs or segs[0].get("layout") != "single":
            problems.append(f"layout {segs[0].get('layout') if segs else 'none'} != single")
    width = int(data.get("width") or 0)
    if exp.get("output_cx") and faces and segs and segs[0].get("crops") and width:
        lo, hi = exp["output_cx"]
        ocx = output_cx(faces[0], segs[0]["crops"][0], width)
        if not (lo <= ocx <= hi):
            problems.append(f"output_cx {ocx:.3f} not in {lo}-{hi}")
    if exp.get("crop_cx_within_face") is not None and faces and segs and segs[0].get("crops") and width:
        crop = segs[0]["crops"][0]
        if "place_w" in crop:
            ocx = output_cx(faces[0], crop, width)
            # Padded panes are judged by where the face lands in the output, not the source crop center.
            if abs(ocx - 0.5) > float(exp["crop_cx_within_face"]) + 0.03:
                problems.append(f"padded face off-centre ({ocx:.3f})")
        else:
            ccx = (crop["x"] + crop["w"] / 2) / width
            if abs(ccx - faces[0]["cx"]) > float(exp["crop_cx_within_face"]):
                problems.append(f"crop_cx {ccx:.3f} far from face {faces[0]['cx']:.3f}")
    return problems


def crop_filter(crop: dict, out_w: int, out_h: int) -> tuple[str, bool]:
    """Return (filter, uses_filter_complex). Mirrors src/lib/reframe.ts paneFilters."""
    place_w = float(crop.get("place_w", 1.0))
    place_h = float(crop.get("place_h", 1.0))
    place_x = float(crop.get("place_x", 0.0))
    place_y = float(crop.get("place_y", 0.0))
    full = place_w >= 0.995 and place_h >= 0.995 and place_x <= 0.005 and place_y <= 0.005
    base = f"crop={int(crop['w'])}:{int(crop['h'])}:{int(crop['x'])}:{int(crop['y'])}"
    if full or "place_w" not in crop:
        return f"{base},scale={out_w}:{out_h}:flags=lanczos,setsar=1", False
    fg_w = max(2, min(out_w - (out_w % 2), int(round((place_w * out_w) / 2) * 2)))
    fg_h = max(2, min(out_h - (out_h % 2), int(round((place_h * out_h) / 2) * 2)))
    fg_x = max(0, min(out_w - fg_w, int(round(place_x * out_w))))
    fg_y = max(0, min(out_h - fg_h, int(round(place_y * out_h))))
    graph = (
        f"[0:v]split=2[f][g];"
        f"[f]{base},scale={fg_w}:{fg_h}:flags=lanczos,setsar=1[fg];"
        f"[g]{base},scale={out_w}:{out_h}:flags=fast_bilinear,boxblur=24:2,setsar=1[bg];"
        f"[bg][fg]overlay={fg_x}:{fg_y}:format=auto[vout]"
    )
    return graph, True


def _pane_chain(crop: dict, label_in: str, label_out: str, w: int, h: int, tag: str) -> str:
    filt, complex_filter = crop_filter(crop, w, h)
    if not complex_filter:
        return f"{label_in}{filt}{label_out}"
    # crop_filter's complex graph assumes [0:v] and [vout]; retarget those labels.
    return filt.replace("[0:v]", label_in).replace("[vout]", label_out).replace("[f]", f"[{tag}f]").replace(
        "[g]", f"[{tag}g]"
    ).replace("[fg]", f"[{tag}fg]").replace("[bg]", f"[{tag}bg]")


def save_crop(video: Path, data: dict, dest: Path) -> None:
    segs = data.get("segments") or []
    if not segs or not segs[0].get("crops"):
        return
    cover_t = float((data.get("cover") or {}).get("t") or 0.0)
    duration = float(data.get("duration") or 0.0)
    t = min(max(cover_t, 0.4), max(0.0, duration - 0.2))
    seg = segs[0]
    dest.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-y", "-ss", f"{t:.3f}", "-i", str(video), "-frames:v", "1"]
    if seg.get("layout") == "dual" and len(seg["crops"]) >= 2:
        half = 960
        graph = (
            "[0:v]split=2[a][b];"
            + _pane_chain(seg["crops"][0], "[a]", "[t]", 1080, half, "t")
            + ";"
            + _pane_chain(seg["crops"][1], "[b]", "[u]", 1080, 1920 - half, "u")
            + ";[t][u]vstack=inputs=2[vout]"
        )
        cmd += ["-filter_complex", graph, "-map", "[vout]"]
    else:
        filt, complex_filter = crop_filter(seg["crops"][0], 1080, 1920)
        if complex_filter:
            cmd += ["-filter_complex", filt, "-map", "[vout]"]
        else:
            cmd += ["-vf", filt]
    cmd += ["-q:v", "2", str(dest)]
    subprocess.run(cmd, check=True, capture_output=True)


def run_one(py: str, video: Path, start: float, end: float) -> tuple[int, dict | None, str]:
    cmd = [py, str(FACE_TRACK), str(video), "--start", str(start), "--end", str(end), "--allow-dual"]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        return proc.returncode, None, proc.stderr.strip()
    try:
        return 0, json.loads(proc.stdout), proc.stderr.strip()
    except json.JSONDecodeError as e:
        return 1, None, f"invalid JSON: {e}; stderr={proc.stderr.strip()}"


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--fixture-dir", default=os.environ.get("FIXTURE_DIR", ""))
    p.add_argument("--python", default=sys.executable)
    p.add_argument("--crops", default="", help="directory for 9:16 crop frames (not committed)")
    args = p.parse_args()
    manifest = json.loads(MANIFEST.read_text())
    fixture_dir = Path(args.fixture_dir) if args.fixture_dir else Path(__file__).resolve().parent
    rows = []
    failed = 0
    for fx in manifest["fixtures"]:
        video = find_video(fx, fixture_dir)
        name = fx["file"]
        if video is None:
            if fx.get("optional"):
                rows.append((name, "SKIP", "optional, env not set"))
                continue
            rows.append((name, "MISSING", f"not in {fixture_dir}"))
            failed += 1
            continue
        digest = sha256(video)
        known = {fx.get("sha256"), fx.get("sha256_qa"), fx.get("sha256_rebuild_ffmpeg_6_1_1")}
        known.discard(None)
        hash_note = "sha256 ok" if digest in known else f"sha256 {digest[:12]} differs from manifest; continuing"
        exp = fx.get("expected") or {}
        start = float(exp.get("eval_start") or 0)
        end = float(exp.get("eval_end") or 0)
        if end <= start:
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(video)],
                capture_output=True,
                text=True,
            )
            end = float(probe.stdout.strip() or 0)
        code, data, err = run_one(args.python, video, start, end)
        if code != 0 or data is None:
            rows.append((name, "FAIL", f"exit {code}: {err[:240]}"))
            failed += 1
            continue
        problems = check(fx, data)
        faces = data.get("faces") or []
        cx = ",".join(f"{f['cx']:.3f}" for f in faces) or "-"
        layout = ",".join(s.get("layout", "?") for s in data.get("segments") or [])
        rate = hit_rate(data)
        summary = (
            f"hit {data.get('samples')}/{data.get('sample_count')} ({rate:.0%}) "
            f"cx={cx} layout={layout} opencv={data.get('opencv')} {hash_note}"
        )
        if problems:
            rows.append((name, "FAIL", summary + " | " + "; ".join(problems)))
            failed += 1
        else:
            rows.append((name, "PASS", summary))
        if args.crops and data.get("segments"):
            out = Path(args.crops) / f"{Path(name).stem}.jpg"
            try:
                save_crop(video, data, out)
            except subprocess.CalledProcessError as e:
                sys.stderr.write(f"crop frame failed for {name}: {e.stderr.decode()[-300:]}\n")
    print(f"{'fixture':<22} {'status':<8} detail")
    for name, status, detail in rows:
        print(f"{name:<22} {status:<8} {detail}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
