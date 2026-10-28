# Personal Clipper

Local-first clipper. UX inspired by ClipperStudio; backend is yours (yt-dlp + ffmpeg + faster-whisper).

Pipeline: YouTube / TikTok / upload → download → transcribe → highlight windows → Skill Packs (cover / hook / reframe / captions) → export MP4.

## Setup

```bash
cd ~/projects/personal-clipper
pnpm install
python3 -m venv ~/.hermes/cache/scratch/personal-clipper-venv
~/.hermes/cache/scratch/personal-clipper-venv/bin/pip install faster-whisper
# optional override:
# export PERSONAL_CLIPPER_PYTHON=~/.hermes/cache/scratch/personal-clipper-venv/bin/python
pnpm dev
```

Open http://localhost:3000

Needs on PATH: `ffmpeg`, `ffprobe`, `yt-dlp`.

## Scripts

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

## Data

- `./data/studios/<id>/studio.json` + rendered clips
- `./data/media/` uploads
- Evidence from ClipperStudio RE: `~/.hermes/cache/scratch/clipperstudio/FEATURE_MAP.md`

Clip scoring is a local speech-density heuristic (not their cloud model).
