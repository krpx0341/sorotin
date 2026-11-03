"""Startup and crop tests for scripts/face_track.py. No fixture videos required."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

import face_track as ft  # noqa: E402

SCRIPT = SCRIPTS / "face_track.py"
ASPECT = 1080 / 1920


def test_this_opencv_can_load_yunet() -> None:
    det = ft.load_yunet()
    assert det.detect(np.zeros((180, 320, 3), np.uint8)) == []
    assert cv2.__version__.split(".")[0] in ("4", "5")


def test_missing_face_detector_is_not_an_attribute_error() -> None:
    # A child process so deleting FaceDetectorYN cannot leak into the other tests.
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import cv2, face_track as ft; del cv2.FaceDetectorYN; ft.load_yunet()",
        ],
        cwd=str(SCRIPTS),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 1
    err = result.stderr
    assert "Traceback" not in err
    assert "AttributeError" not in err
    assert "FaceDetectorYN" in err
    assert "opencv-python-headless>=4.8,<6" in err
    assert cv2.__version__ in err
    assert "OpenCV 4" in err
    assert "OpenCV 5" in err


def test_missing_model_names_the_file(capsys: pytest.CaptureFixture[str]) -> None:
    old = os.environ.get("SOROTIN_YUNET_MODEL")
    os.environ["SOROTIN_YUNET_MODEL"] = "/tmp/sorotin-missing-yunet.onnx"
    try:
        with pytest.raises(SystemExit) as cm:
            ft.load_yunet()
        assert cm.value.code == 1
    finally:
        if old is None:
            os.environ.pop("SOROTIN_YUNET_MODEL", None)
        else:
            os.environ["SOROTIN_YUNET_MODEL"] = old
    err = capsys.readouterr().err
    assert "Traceback" not in err
    assert "face_detection_yunet_2023mar.onnx" in err
    assert "SOROTIN_YUNET_MODEL" in err


def test_cli_missing_model_exits_1_without_traceback() -> None:
    env = os.environ.copy()
    env["SOROTIN_YUNET_MODEL"] = "/tmp/sorotin-missing-yunet.onnx"
    proc = subprocess.run(
        [sys.executable, str(SCRIPT), "no-such-video.mp4"],
        capture_output=True,
        text=True,
        env=env,
    )
    assert proc.returncode == 1
    assert "Traceback" not in proc.stderr
    assert "AttributeError" not in proc.stderr
    assert "face_track:" in proc.stderr
    assert "YuNet" in proc.stderr


def test_blank_clip_exits_0_with_center_layout(tmp_path: Path) -> None:
    path = tmp_path / "blank.avi"
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), 10, (320, 180))
    if not writer.isOpened():
        pytest.skip("OpenCV VideoWriter could not open an MJPG avi")
    blank = np.zeros((180, 320, 3), np.uint8)
    for _ in range(8):
        writer.write(blank)
    writer.release()
    proc = subprocess.run(
        [sys.executable, str(SCRIPT), str(path), "--start", "0", "--end", "0.6", "--step", "0.3"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stderr
    assert "Traceback" not in proc.stderr
    data = json.loads(proc.stdout)
    assert data["detector"] == "yunet"
    assert data["segments"][0]["layout"] == "center"
    assert data["samples"] == 0
    assert data["sample_count"] > 0


def test_centered_face_keeps_the_old_crop_integers() -> None:
    face = {
        "cx": 0.56875,
        "cy": 0.37288888888888894,
        "face_w": 0.26640625,
        "face_h": 0.4736111111111111,
    }
    crop = ft.pane_crop(face, 1280, 720, ASPECT, 0.28, 0.75, 0.30, None)
    assert crop == {"x": 526, "y": 0, "w": 404, "h": 720}


def test_right_edge_face_stays_near_the_middle_of_the_pane() -> None:
    face = {
        "cx": 0.871875,
        "cy": 0.43761111111111106,
        "face_w": 0.2328125,
        "face_h": 0.41388888888888886,
    }
    crop = ft.pane_crop(face, 1280, 720, ASPECT, 0.28, 0.75, 0.30, None)
    assert "place_w" in crop
    assert crop["place_w"] < 0.98
    face_px = face["cx"] * 1280
    out_cx = crop["place_x"] + (face_px - crop["x"]) / crop["w"] * crop["place_w"]
    assert 0.45 < out_cx < 0.55
    left = (face["cx"] - face["face_w"] / 2) * 1280
    right = (face["cx"] + face["face_w"] / 2) * 1280
    assert left >= crop["x"] - 2
    assert right <= crop["x"] + crop["w"] + 2
