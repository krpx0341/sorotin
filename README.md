# Sorotin

> Sorot momen terbaikmu. (Repo/folder name stays `personal-clipper`.)

Local clipper. UX inspired by ClipperStudio; backend is yours (yt-dlp + ffmpeg + faster-whisper).

Pipeline: YouTube / TikTok / upload → download → transcribe → highlight windows → Skill Packs (cover / hook / reframe / captions) → export MP4.

## Setup

```bash
cd ~/projects/personal-clipper
pnpm install
python3 -m venv ~/.hermes/cache/scratch/personal-clipper-venv
~/.hermes/cache/scratch/personal-clipper-venv/bin/pip install faster-whisper "opencv-python-headless>=4.8,<5"
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
pnpm tauri:dev     # desktop window (needs ffmpeg/yt-dlp/python on PATH)
```

## AI ranking (9router / OpenAI-compatible)

1. Open `/settings`
2. Base URL e.g. `http://127.0.0.1:20128/v1`
3. Paste API key → **Fetch models** → pilih model → enable → Save
4. Next studio create akan rank clip via AI; gagal → fallback lokal

Settings file: `data/settings.json` (gitignored via `/data`).

## Render

- Timed ASS captions with keyword highlights (not one static drawtext)
- Face-aware 9:16 crop via `scripts/face_track.py` (OpenCV Haar; falls back to center)
- Hook title only in the first ~2.8s
- Local + AI ranking with Hook / Flow / Value / Trend grades and complete-thought snaps

## Desktop & license

`pnpm tauri:dev` opens a Tauri 2 window around this Next app. Linux installers live in `dist/` (`Sorotin-0.1.0-linux-x86_64.AppImage`): chmod +x, open, paste an `SRT-…` license key. ffmpeg / yt-dlp / Python are inside the AppImage.

Windows NSIS and macOS DMG are built on GitHub Actions (public repo, free standard runners). Run **Actions → desktop → Run workflow**, or push a `v*` tag. Installers appear as workflow artifacts (14 days) and on the GitHub Release for tags. The Mac build is unsigned Apple Silicon. Gatekeeper will ask for Open Anyway. No API key is stored in CI. Paste your key in Settings after install.

License: Google Sheet + Apps Script (`license-appscript/`). Mint from the sheet menu; the app writes activate / last-seen into the same spreadsheet.
