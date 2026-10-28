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

## AI ranking (9router / OpenAI-compatible)

1. Open `/settings`
2. Base URL e.g. `http://127.0.0.1:20128/v1`
3. Paste API key → **Fetch models** → pilih model → enable → Save
4. Next studio create akan rank clip via AI; gagal → fallback lokal

Settings file: `data/settings.json` (gitignored via `/data`).
