#!/usr/bin/env python3
"""Transcribe wav/audio with faster-whisper. stdout = JSON segments (+ words).

Loads audio via stdlib wave + numpy to avoid PyAV/ffmpeg ABI mismatches.
Expects 16-bit PCM WAV (pipeline extracts with ffmpeg).
"""
from __future__ import annotations

import argparse
import json
import sys
import wave
from pathlib import Path

import numpy as np


def load_wav_mono_f32(path: Path, target_sr: int = 16000) -> np.ndarray:
    with wave.open(str(path), "rb") as w:
        channels = w.getnchannels()
        width = w.getsampwidth()
        rate = w.getframerate()
        frames = w.readframes(w.getnframes())
    if width != 2:
        raise ValueError(f"expected 16-bit PCM wav, got sample width {width}")
    audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    if rate != target_sr:
        duration = audio.shape[0] / float(rate)
        new_len = int(duration * target_sr)
        if new_len <= 0:
            return np.zeros(0, dtype=np.float32)
        x_old = np.linspace(0.0, 1.0, num=audio.shape[0], endpoint=False)
        x_new = np.linspace(0.0, 1.0, num=new_len, endpoint=False)
        audio = np.interp(x_new, x_old, audio).astype(np.float32)
    return audio


STYLE_PROMPTS = {
    "id": "Halo, apa kabar? Aku baik-baik aja. Jadi, ceritanya begini. Terus, kamu gimana?",
    "en": "Hello, how are you? I'm doing well. So, here's the story. And then, what about you?",
}


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("media")
    p.add_argument("--model", default="large-v3-turbo")
    p.add_argument("--language", default="id")
    p.add_argument("--device", default="cpu")
    args = p.parse_args()

    media = Path(args.media)
    if not media.exists():
        print(json.dumps({"error": f"missing media: {media}"}), file=sys.stderr)
        return 1

    from faster_whisper import WhisperModel

    audio = load_wav_mono_f32(media)
    model = WhisperModel(args.model, device=args.device, compute_type="int8")
    segments_iter, info = model.transcribe(
        audio,
        language=None if args.language == "auto" else args.language,
        vad_filter=True,
        word_timestamps=True,
        # Long files: conditioning on previous text makes Whisper drift into an
        # unpunctuated, 1-word-segment mode after a few minutes (seen on a 45-min
        # podcast: punctuation dropped from ~50% to ~1% of segments). Independent
        # windows + a punctuated style prompt keep full sentences.
        condition_on_previous_text=False,
        initial_prompt=STYLE_PROMPTS.get(args.language),
    )
    segments = []
    for s in segments_iter:
        text = (s.text or "").strip()
        if not text:
            continue
        words = []
        for w in s.words or []:
            token = (w.word or "").strip()
            if not token:
                continue
            words.append(
                {
                    "start": float(w.start),
                    "end": float(w.end),
                    "word": token,
                }
            )
        segments.append(
            {
                "start": float(s.start),
                "end": float(s.end),
                "text": text,
                "words": words,
            }
        )
    print(
        json.dumps(
            {
                "language": info.language,
                "duration": float(info.duration or 0),
                "segments": segments,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
