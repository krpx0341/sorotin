"""Startup and crop tests for scripts/face_track.py. No fixture videos required.

    python -m unittest discover -s scripts -p 'test_*.py' -v
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

import face_track as ft

SCRIPT = Path(__file__).resolve().parent / "face_track.py"
ASPECT = 1080 / 1920


class DetectorStartupTest(unittest.TestCase):
    def test_this_opencv_can_load_yunet(self):
        det = ft.load_yunet()
        self.assertEqual(det.detect(np.zeros((180, 320, 3), np.uint8)), [])
        major = ft.cv2.__version__.split(".")[0]
        self.assertIn(major, ("4", "5"))

    def test_missing_face_detector_is_not_an_attribute_error(self):
        saved = cv2.FaceDetectorYN
        buf = io.StringIO()
        try:
            del cv2.FaceDetectorYN
            with contextlib.redirect_stderr(buf):
                with self.assertRaises(SystemExit) as cm:
                    ft.load_yunet()
            self.assertEqual(cm.exception.code, 1)
        finally:
            cv2.FaceDetectorYN = saved
        err = buf.getvalue()
        self.assertNotIn("Traceback", err)
        self.assertNotIn("AttributeError", err)
        self.assertIn("FaceDetectorYN", err)
        self.assertIn("opencv-python-headless>=4.8,<6", err)
        self.assertIn(cv2.__version__, err)
        self.assertIn("OpenCV 4", err)
        self.assertIn("OpenCV 5", err)

    def test_missing_model_names_the_file(self):
        buf = io.StringIO()
        old = os.environ.get("SOROTIN_YUNET_MODEL")
        os.environ["SOROTIN_YUNET_MODEL"] = "/tmp/sorotin-missing-yunet.onnx"
        try:
            with contextlib.redirect_stderr(buf):
                with self.assertRaises(SystemExit) as cm:
                    ft.load_yunet()
            self.assertEqual(cm.exception.code, 1)
        finally:
            if old is None:
                os.environ.pop("SOROTIN_YUNET_MODEL", None)
            else:
                os.environ["SOROTIN_YUNET_MODEL"] = old
        err = buf.getvalue()
        self.assertNotIn("Traceback", err)
        self.assertIn("face_detection_yunet_2023mar.onnx", err)
        self.assertIn("SOROTIN_YUNET_MODEL", err)

    def test_cli_missing_model_exits_1_without_traceback(self):
        env = os.environ.copy()
        env["SOROTIN_YUNET_MODEL"] = "/tmp/sorotin-missing-yunet.onnx"
        proc = subprocess.run(
            [sys.executable, str(SCRIPT), "no-such-video.mp4"],
            capture_output=True,
            text=True,
            env=env,
        )
        self.assertEqual(proc.returncode, 1)
        self.assertNotIn("Traceback", proc.stderr)
        self.assertNotIn("AttributeError", proc.stderr)
        self.assertIn("face_track:", proc.stderr)
        self.assertIn("YuNet", proc.stderr)

    def test_blank_clip_exits_0_with_center_layout(self):
        fd, path = tempfile.mkstemp(suffix=".avi")
        os.close(fd)
        try:
            writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"MJPG"), 10, (320, 180))
            if not writer.isOpened():
                self.skipTest("OpenCV VideoWriter could not open an MJPG avi")
            blank = np.zeros((180, 320, 3), np.uint8)
            for _ in range(8):
                writer.write(blank)
            writer.release()
            proc = subprocess.run(
                [sys.executable, str(SCRIPT), path, "--start", "0", "--end", "0.6", "--step", "0.3"],
                capture_output=True,
                text=True,
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertNotIn("Traceback", proc.stderr)
            data = json.loads(proc.stdout)
            self.assertEqual(data["detector"], "yunet")
            self.assertEqual(data["segments"][0]["layout"], "center")
            self.assertEqual(data["samples"], 0)
            self.assertGreater(data["sample_count"], 0)
        finally:
            os.remove(path)


class CropTest(unittest.TestCase):
    def test_centered_face_keeps_the_old_crop_integers(self):
        face = {
            "cx": 0.56875,
            "cy": 0.37288888888888894,
            "face_w": 0.26640625,
            "face_h": 0.4736111111111111,
        }
        crop = ft.pane_crop(face, 1280, 720, ASPECT, 0.28, 0.75, 0.30, None)
        self.assertEqual(crop, {"x": 526, "y": 0, "w": 404, "h": 720})

    def test_right_edge_face_stays_near_the_middle_of_the_pane(self):
        face = {
            "cx": 0.871875,
            "cy": 0.43761111111111106,
            "face_w": 0.2328125,
            "face_h": 0.41388888888888886,
        }
        crop = ft.pane_crop(face, 1280, 720, ASPECT, 0.28, 0.75, 0.30, None)
        self.assertIn("place_w", crop)
        self.assertLess(crop["place_w"], 0.98)
        face_px = face["cx"] * 1280
        out_cx = crop["place_x"] + (face_px - crop["x"]) / crop["w"] * crop["place_w"]
        self.assertGreater(out_cx, 0.45)
        self.assertLess(out_cx, 0.55)
        left = (face["cx"] - face["face_w"] / 2) * 1280
        right = (face["cx"] + face["face_w"] / 2) * 1280
        self.assertGreaterEqual(left, crop["x"] - 2)
        self.assertLessEqual(right, crop["x"] + crop["w"] + 2)


if __name__ == "__main__":
    unittest.main()
