"""Smoke tests for scripts/*.py. No network and no Whisper model download."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from importlib.metadata import version
from pathlib import Path

import cv2
import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"
FIXTURES = ROOT / "tests" / "fixtures"
SCRIPT_NAMES = ("face_track.py", "hook_card.py", "transcribe.py")


def run_script(name: str, args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPTS / name), *args],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )


def test_opencv_locked_below_5() -> None:
    # The wheel reports cv2.__version__ as 4.14.0; the distribution pin is 4.14.0.94.
    assert version("opencv-python-headless") == "4.14.0.94"
    assert version("numpy") == "2.5.4"
    assert int(cv2.__version__.split(".", 1)[0]) < 5
    assert hasattr(cv2, "CascadeClassifier")
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_alt2.xml")
    assert not cascade.empty()


@pytest.mark.parametrize("name", SCRIPT_NAMES)
def test_scripts_import_and_help(name: str) -> None:
    path = SCRIPTS / name
    spec = importlib.util.spec_from_file_location(path.stem + "_smoke", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    # dataclass string annotations look up the class module in sys.modules.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    assert callable(module.main)
    result = run_script(name, ["--help"])
    assert result.returncode == 0, result.stderr
    assert "usage" in result.stdout.lower()


def test_face_track_synthetic_video(tmp_path: Path) -> None:
    video = tmp_path / "synthetic.avi"
    width, height, fps, frames = 320, 180, 10, 12
    writer = cv2.VideoWriter(
        str(video),
        cv2.VideoWriter_fourcc(*"MJPG"),
        fps,
        (width, height),
    )
    assert writer.isOpened()
    for _ in range(frames):
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        frame[:, :] = (30, 60, 90)
        cv2.circle(frame, (width // 2, height // 3), 28, (180, 200, 220), -1)
        writer.write(frame)
    writer.release()

    result = run_script("face_track.py", [str(video), "--end", "1.0"])
    assert result.returncode == 0, result.stderr
    assert "Traceback" not in result.stderr
    data = json.loads(result.stdout)
    assert data["width"] == width
    assert data["height"] == height
    assert isinstance(data["segments"], list) and data["segments"]
    assert data["segments"][0]["layout"] in {"single", "dual", "center"}
    assert "cover" in data


def test_hook_card_writes_png(tmp_path: Path) -> None:
    out = tmp_path / "hook.png"
    font = ROOT / "vendor" / "fonts" / "NotoSans-Black.ttf"
    assert font.is_file()
    result = run_script(
        "hook_card.py",
        [
            "--text",
            "Ini hook singkat",
            "--frame-w",
            "1080",
            "--frame-h",
            "1920",
            "--font",
            str(font),
            "--out",
            str(out),
        ],
    )
    assert result.returncode == 0, result.stderr
    meta = json.loads(result.stdout)
    assert meta["w"] > 0 and meta["h"] > 0
    assert out.read_bytes().startswith(b"\x89PNG\r\n\x1a\n")


def test_transcribe_missing_file_does_not_load_model(tmp_path: Path) -> None:
    result = run_script("transcribe.py", [str(tmp_path / "missing.wav")])
    assert result.returncode == 1
    err = json.loads(result.stderr)
    assert "error" in err
    combined = result.stdout + result.stderr
    assert "faster_whisper" not in combined
    assert "WhisperModel" not in combined


def test_manifest_fixture_has_no_videos_or_workspace_paths() -> None:
    manifest = FIXTURES / "manifest.json"
    readme = (FIXTURES / "README.md").read_text().lower()
    blob = manifest.read_text()
    data = json.loads(blob)
    assert "/workspace" not in blob
    assert "ours.mp4" not in blob
    assert not list(FIXTURES.glob("*.mp4"))
    assert not list(FIXTURES.glob("*.webm"))
    assert "source_file_url" in readme or "unduh" in readme
    assert any("CC BY" in item["attribution"] or "CC BY" in item["license"] for item in data["fixtures"])
    for item in data["fixtures"]:
        assert not Path(item["file"]).is_absolute()
        assert item["file"].endswith(".mp4")
        assert len(item["sha256"]) == 64
        assert item["license"]
        assert item["attribution"]
        assert item["duration_sec"] > 0
        assert "x" in item["resolution"]
        assert "expected" in item
        assert item["source_page"].startswith("https://")
        assert item["source_file_url"].startswith("https://")
