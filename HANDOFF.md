# Sorotin — Handoff

> Repo/folder: `personal-clipper` (internal identifiers & env vars keep the `PERSONAL_CLIPPER_*` prefix).
> State as of **30 Oct 2026, 17:20 WIB**. Everything below was read from the code, not from memory.

## Ringkasan (Bahasa Indonesia)

- **Sorotin** = clipper video lokal: link YouTube/TikTok, upload, atau path file lokal → Whisper → pilih momen (AI via 9router atau lokal) → reframe 9:16 ikut wajah per-shot (single / split atas-bawah) → caption karaoke → kartu hook → cover → MP4.
- Jalankan: `pnpm dev` (port 3000). Butuh `ffmpeg`, `ffprobe`, `yt-dlp` di PATH dan venv Python berisi `faster-whisper`, `opencv-python-headless`, `Pillow`.
- AI: atur di `/settings` (tersimpan di `data/settings.json`, default `http://127.0.0.1:20128/v1`). Kalau AI mati/gagal → skor "Estimasi lokal".
- **Re-render** = pakai transkrip + potongan clip yang ada (cepat). **Reprocess** = transkripsi + pilih clip ulang (lama).
- Cek: `pnpm typecheck`, `pnpm test` (46 test), `pnpm lint` — semua lulus saat handoff.
- Prioritas TODO: sumber 720p terlihat lembek, split layout saat wajah di tepi frame, judul lokal (tanpa AI) masih lemah, `/api/files` tanpa Range, folder clip lama tidak dibersihkan, cuma dev server.
- **Banyak perubahan belum di-commit** (lihat bagian Git di bawah).

---

## 1. Product & brand

- **Name:** Sorotin. Tagline ID "Sorot momen terbaikmu." / EN "Spotlight your best moments."
- **Mark:** emerald viewfinder corners + yellow "spot"; wordmark has a yellow dot over the *i*.
- **Assets:** `public/brand/`
  - `sorotin-logo.svg` (tight crop, used in the header)
  - `sorotin-mark.svg` (mobile header)
  - `sorotin-logo-dark|transparent.svg/png`, `sorotin-icon-512.svg/png`, `sorotin-icon-small.svg`
  - `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (manifest)
- **App icons** (Next file conventions in `src/app/`): `favicon.ico` (16/32 use the bold small mark), `icon.svg`, `apple-icon.png`, `opengraph-image.png`, `manifest.ts`.
- **Palette** (`src/app/globals.css` `:root`):

  | Name | Hex |
  |---|---|
  | Ink (background) | `#0A0F0D` |
  | Emerald | `#10B981` |
  | Forest | `#047857` |
  | Spot (use sparingly — matches karaoke caption yellow) | `#FACC15` |
  | Glow | `#FDE68A` |
  | Snow (foreground) | `#F5F5F4` |

  Tailwind tokens: `bg-spot`, `text-glow`, `bg-forest`, `font-display`. Panels: `.panel` / `.card` (ink-green gradient).
- **Fonts** (`src/app/layout.tsx`, `next/font/google`): Geist (UI body), Geist Mono, **Plus Jakarta Sans** 600/700/800 as `--font-jakarta` (all `h1`/`h2` + `font-display`). Burned-in captions use **Noto Sans Black** from `/usr/share/fonts/noto` (`src/lib/captions.ts`); cover text uses `/usr/share/fonts/noto/NotoSans-Black.ttf`.
- **Metadata:** title template `%s · Sorotin`; settings and studio pages set their own titles (`settings/layout.tsx`, `studios/[id]/layout.tsx`). `SOROTIN_BASE_URL` sets `metadataBase` (OG absolute URLs).

## 2. Running it

```bash
pnpm install
pnpm dev            # http://localhost:3000 (Turbopack). Log on voyager: /tmp/clipper-dev.log
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest run
pnpm lint           # eslint
```

**System tools on PATH:** `ffmpeg`/`ffprobe` (tested n9.0.2), `yt-dlp` (tested 2026.08.19).

**Python** (tested 3.14). Default interpreter is `~/.hermes/cache/scratch/personal-clipper-venv/bin/python`; override with `PERSONAL_CLIPPER_PYTHON`.
```bash
python3 -m venv ~/.hermes/cache/scratch/personal-clipper-venv
~/.hermes/cache/scratch/personal-clipper-venv/bin/pip install faster-whisper "opencv-python-headless>=4.8,<5" pillow
# tested: faster-whisper 1.2.1, ctranslate2 4.8.4, opencv-python-headless 4.14, pillow 13.0, numpy 2.5
```

| Script | What it does |
|---|---|
| `scripts/transcribe.py` | faster-whisper, `--model base` default, CPU int8, word timestamps → JSON |
| `scripts/face_track.py` | OpenCV shot / face analysis → JSON plan |
| `scripts/hook_card.py` | Pillow hook card PNG |

**Environment variables** (all optional):

| Var | Default | Used in |
|---|---|---|
| `PERSONAL_CLIPPER_PYTHON` | venv path above | `pipeline.ts clipperPython()` |
| `PERSONAL_CLIPPER_DATA_DIR` | `./data` | `store.ts` (studios, media, index) |
| `PERSONAL_CLIPPER_WHISPER_MODEL` | `large-v3-turbo` | `transcribe()` |
| `PERSONAL_CLIPPER_HOOK_SEC` | `3.5` | how long the hook card shows (fades out over the last 0.3s, no fade-in) |
| `PERSONAL_CLIPPER_COVER_SCORE` | off | `=1` burns the AI score chip onto `cover.jpg` |
| `PERSONAL_CLIPPER_TARGET_SEC` | `40` | target clip length if the studio has none |
| `PERSONAL_CLIPPER_MAX_CLIPS` | `8` | clips per studio |
| `PERSONAL_CLIPPER_FORMAT` | built-in yt-dlp format string | `downloadUrlOnce()` |
| `PERSONAL_CLIPPER_FRAGMENTS` | `8` | yt-dlp concurrent fragments |
| `PERSONAL_CLIPPER_DOWNLOAD_ATTEMPTS` | `3` | retries (permanent errors are not retried) |
| `PERSONAL_CLIPPER_DOWNLOAD_TIMEOUT_SEC` | `2700` | hard yt-dlp timeout |
| `PERSONAL_CLIPPER_DOWNLOAD_IDLE_SEC` | `180` | kill yt-dlp after this long without output |
| `SOROTIN_BASE_URL` | `http://localhost:3000` | OG metadata base |

**AI settings:** `data/settings.json` (gitignored, contains the API key — never commit or print it). Schema in `src/lib/ai-settings.ts`: `{ baseUrl, apiKey, model, enabled }`, default base `http://127.0.0.1:20128/v1` (9router, OpenAI-compatible). Current setup: model `cx/gpt-6.1-sol`, enabled. Edit via `/settings`; "Tes koneksi" makes a real tiny call (`/api/ai/test`).

## 3. Architecture

### Data & state

- `data/index.json` lists studio ids. Each studio lives at `data/studios/<id>/`:
  - `studio.json`, `source/` (download), `audio.wav`
  - `clips/<clipId>/` with `9x16.mp4`, `cover.jpg`, `captions.ass`, `hook.png`
- Uploads go to `data/media/<uuid>.<ext>`; local paths are used in place (`resolveLocalVideo`).
- Types are in `src/lib/types.ts`:
  - `Studio` has `title` (original), `displayTitle` + `displayTitleSource` (`ai | local | user`), `ranking`, `skills`, `transcript`, `clips`.
  - `ClipCandidate` / `RenderedClip` have `start`, `end`, `title`, `titleSource`, `titleEdited`, `hook`, `scoring`, `grades`, `status`, `previewPath`, `coverPath`.
- `src/lib/store.ts`: `loadStudio` → `reconcileStale()`. A studio in a busy status with no live job in this server process is marked `error` with `INTERRUPTED_MESSAGE`. This is stale-job recovery after a restart or sleep.
- `src/lib/jobs.ts`: per-process job registry on `globalThis.__clipperJobs` (shared across route bundles and HMR).
  - `beginJob`, `trackChild` (child processes get killed on stop), `stopJob`, `assertNotAborted`, `JobAbortedError`.
  - Jobs run inside the Next server process (fire-and-forget from route handlers).
- Files are served by `GET /api/files?path=data/...` (allow-listed roots `data`, `public`).

### API routes

| Route | Purpose |
|---|---|
| `GET/POST/PATCH /api/studios` | list; create (JSON link, or multipart `file` / `localPath`); patch (`skills`, `exportAspect`, `rerender`, `reprocess`, `displayTitle`, `clipId` + `clipPatch` {liked, hidden, title, description}). A real title change sets `titleEdited` |
| `GET/POST /api/studios/[id]` | get; `{action:"stop"}` / `{action:"reprocess"}` |
| `GET/PUT /api/settings` | AI settings (key masked) |
| `GET/POST /api/ai/models` | model list (5-min cache) |
| `POST /api/ai/test` | connection test |

### Pipeline — `src/lib/pipeline.ts`

`processStudio(id)` runs the full job; progress is written with `bump()`. Stages:

1. **Source:**
   - YouTube/TikTok via `downloadUrl()` → `downloadUrlOnce()` (yt-dlp with progress parse, retries, idle/total timeouts, `friendlyDownloadError`).
   - Upload via `saveUpload()`; local file via `resolveLocalVideo()`.
   - Skipped when `mediaPath` already exists (reprocess).
2. **Transcribe:** `probeDuration` → `extractAudio` (wav) → `transcribe()` → `scripts/transcribe.py` (word timestamps).
3. **Clip selection:**
   - `detectSilences` + `detectScenes` (ffmpeg).
   - With AI enabled: `rankClipsWithAi()` (`src/lib/ai.ts`; transcript merged into ~12s blocks, returns start/end/title/hook/scores/reasons).
   - Otherwise or on failure: `proposeClips()` (`src/lib/clipper.ts`: transcript, silence and scene windows, `snapToCompleteThought`).
   - The outcome is recorded in `studio.ranking`.
4. **Scoring + titles:**
   - `ensureScoring()` grades clips lacking an AI score, or lacking an AI title, in one `scoreClipsWithAi()` call. Existing AI grades are kept stable.
   - Fallback is `scoreLocally()`.
   - Untitled raw titles get `localTitle()`. `titleEdited` titles are never touched.
   - `ensureStudioTitle()` writes `displayTitle`: AI `studioTitleWithAi()`, else `cleanStudioTitle()` from `src/lib/title.ts`. A user rename wins.
5. **Render each clip** — `renderClip()`:
   - **Shots:** `faceCropCenter()` runs `scripts/face_track.py` for the window. One sequential decode:
     - hard-cut detection from 64×36 frame signatures
     - Haar faces + eyes + skin filter + content-rect (inset) detection every 0.5s
     - per shot: `plan_segment()` → `single | dual | center`
     - `resolve_shots()`: short or face-less shots borrow the crop of the most similar reliable-face shot (same camera angle via signature distance ≤ `SAME_ANGLE_DIFF`)
     - flash frames: a hard cut within `EDGE_TRIM` = 0.2s of a clip edge → `trim_start` / `trim_end`, and `renderClip` shifts `clip.start` / `clip.end`
     - cover moment pick
   - **Reframe:** `src/lib/reframe.ts`
     - `parseSegments()` → `buildReframeGraph()`: split → per-segment trim → `layoutGraph()` (single crop+scale, or **dual** = two face crops vstacked top/bottom) → concat → `[base]`.
     - Split is only allowed for 9:16.
   - **Captions:** `src/lib/captions.ts`
     - `wordsForClip` → `buildAssCaptions` (3-word karaoke chunks, keyword highlight in yellow).
     - Per-shot placement via `captionPlacements()` / `pickCaptionBottom()`: on split shots the band moves off faces and the seam; single shots keep the default margin.
     - Burned with ffmpeg `ass=` + `fontsdir`.
   - **Hook card:** `scripts/hook_card.py`
     - Pillow, real font measurement, balanced 1–3 lines, styles `classic|dark|clapper|bold|sticker`.
     - Placed with `pickHookTop()` to avoid faces (dual → bottom ≤ 0.46, single → ≤ 0.62).
     - Overlaid for `HOOK_SECONDS` with filter_complex `overlay`, fully opaque from frame 0.
   - **Cover:** `renderSmartCover()` at `face.cover.t`, same layout as that shot. The scrim band + emerald bars + headline (`clip.hook || clip.title`, `splitCoverTitle` widens instead of "…"). Score chip only with `PERSONAL_CLIPPER_COVER_SCORE=1`.

**`rerenderStudio(id)`** keeps transcript + clip windows (and every clip field except status/error). It runs `ensureScoring` + `ensureStudioTitle`, then `renderClip` for each clip.
- PATCH `{rerender:true}`. Skill packs "Apply" uses this.

**Reprocess** (`POST /api/studios/[id] {action:"reprocess"}`) reruns `processStudio`. This means re-transcribe + new clip selection; the download is reused.

### Scoring model — `src/lib/scoring.ts`

- Parts 0–10: **Hook** (.35), **Emosi** (.20), **Payoff** (.25), **Jelas/clarity** (.20).
- `combineParts()` → 0–100.
- `gradesFromParts()` maps to legacy `ViralityGrades`.
- **AI:**
  - The prompt `SCORING_RULES` in `ai.ts` is calibrated (typical clips 40–70).
  - Returns reasons (≤3, ≤80 chars) and a model id. `source:"ai"`.
- **Local:**
  - `localScoring()` is a rate-based heuristic (questions, emotion words, complete sentences, filler).
  - Labelled **"Estimasi lokal"** / "est." in the UI, `source:"local"`.
  - Old studios without `scoring` show "lama".
- Hooks: `sanitizeHook()` (≤ `HOOK_MAX_WORDS` = 8, whole words) and `localHookLine()`.
- Titles: `sanitizeTitle()` (≤ 64 chars, no emoji/hashtags) and `localTitle()` (whole sentence ≤ 12 words, rewards substance).
- UI helper: `clipScoreInfo()` in `src/lib/ui.ts`.

### UI

| Area | Files | What's there |
|---|---|---|
| Shell | `src/components/AppShell.tsx` | logo/wordmark, Studio/Settings nav, optional actions |
| Home `/` | `src/app/page.tsx` + `src/components/home/NewClipParts.tsx` | tagline hero, source tabs (YouTube / TikTok / Upload incl. drag-drop + local path), advanced options panel, AI model chip, studio cards (`studioDisplayTitle`) |
| Settings `/settings` | `src/app/settings/page.tsx` + `ModelPicker.tsx` | connection card + Tes koneksi, recommendations (`src/lib/model-catalog.ts`: dedupe/rank 300+ 9router models), searchable model picker, enable toggle, save bar |
| Studio `/studios/[id]` | `src/app/studios/[id]/page.tsx` + `ClipWorkspace.tsx` | `EditableTitle` (inline rename), original title subtitle, source chip, progress (only while busy/stopped), Skill packs (Switch + Select), clip grid of 9:16 cards / list view, side panel (player, score + parts + reasons, hook, title/description editing via per-clip drafts, transcript, Download, SRT via `src/lib/export.ts`) |
| Shared | `Switch.tsx`, `Select.tsx` | toggle; custom keyboard-accessible dropdown |

UI copy is Indonesian.

## 4. Tests & checks (at handoff)

- `pnpm typecheck` ✔
- `pnpm lint` ✔ 0 problems
- `pnpm test` ✔ **46 tests in 7 files**: `ai`, `model-catalog`, `pipeline`, `reframe`, `robustness`, `scoring`, `title` (`*.test.ts` in `src/lib/`)
- `scripts/*.py` have no automated tests. Verify visually by extracting frames, e.g.
  `ffmpeg -i data/studios/<id>/clips/<clip>/9x16.mp4 -vf "select=lt(n\,3),tile=3x1" -frames:v 1 out.jpg`
- Reference studio used for QA: `a0194883-24e4-49a0-aa41-dd4fb03454c5` (45-min podcast, 8 clips, AI-scored 37–66).

## 5. Known limitations / TODO (ranked by impact)

1. **Soft output from 720p sources.** Face crops upscale a ~300–400px wide region to 1080 wide. Prefer ≥1080p downloads (`PERSONAL_CLIPPER_FORMAT`) and/or add sharpening / a better scaler (lanczos + mild unsharp), or warn in the UI when the source height < 1080.
2. **Split (dual) layout when faces sit at the frame edge.** The pane crop is clamped to the frame, so an edge face ends up off-centre in its pane. Two improvements:
   - fall back to single when a face is within ~8% of the edge, or
   - pad/blur-fill the pane.

   Detection is Haar-based. A DNN detector (OpenCV YuNet) would cut false positives (posters, figurines) and miss fewer profiles.
3. **Local (no-AI) titles are weak.** `localTitle()` / `cleanStudioTitle()` can't fix Whisper noise or restore censored words; quality is ~50/50. AI titles are good. Options: a small local LLM, or better sentence scoring.
4. **`/api/files` reads whole files into memory and has no HTTP Range support.** Seeking in long previews is poor and memory use is high. `Cache-Control: max-age=60` on a constant URL can show a stale preview right after a re-render (add `?v=updatedAt`). Stream with Range instead.
5. **Dev-only server; jobs live in the web process.** Jobs run in-process (`next dev`). A restart marks running studios as interrupted (by design), but there is no queue, no concurrency limit and no resume. `next build`/`start` hasn't been exercised recently. Turbopack's watcher once missed `globals.css` edits made with `sed -i` (fixed by restarting `pnpm dev`).
6. **Leftover data:**
   - Re-renders/reprocesses never delete old `clips/<id>/` folders. E.g. a0194883 has 24 clip folders for 8 clips, 658 MB.
   - Studio `da84439c…` (0 clips, 832 MB) and `data/eno-check/` (old QA screenshots) are leftovers.
   - Add a cleanup that keeps only folders of current clip ids (+ a "delete studio" action).
7. **Single-speaker cropping is per shot, not per moment.** Within one long shot the crop is static; speaker switches inside a wide two-shot only become split if both faces are detected reliably. Active-speaker detection (audio/lip activity) would be the next big quality step.
8. **Whisper default is `large-v3-turbo`** (CPU int8). First run downloads ~1.6 GB into app-data `models/`. Override with `PERSONAL_CLIPPER_WHISPER_MODEL` (`small` if the machine is weak). No GPU path beyond `--device`.
9. **No export presets / batch download / direct upload to TikTok/YouTube.** Only 9:16 is exercised heavily; 1:1 and 16:9 are less tested.
10. **`hook_card.py` accent colours** still use the old emerald-400 (52,211,153), not brand `#10B981`. Cosmetic.

## 6. Desktop (Tauri 2) & license

**Goal:** an installable Sorotin for non-technical users; everything local, BYO API key.

**Done (30 Oct 2026):**
- Tauri 2 shell in `src-tauri/`. `pnpm tauri:dev` opens a window on `http://localhost:3000`.
- **Linux AppImage (x86_64):** pack with `scripts/package-linux.sh` after `tauri:build`. That script **replaces linuxdeploy's ELF AppRun** with `scripts/sorotin-appimage-apprun.sh` (system GStreamer, `WEBKIT_DISABLE_DMABUF_RENDERER`, native Wayland. Do not force `GDK_BACKEND=x11`). Window starts maximized, no GTK title bar. The binary must not call `hyprctl`. A previous fill-the-screen hack dispatched Lua into the live compositor and threw Hyprland's error overlay (`hl.focus: window not found`) on every launch. The old ELF AppRun black-screens WebKit. Bundles Node, ffmpeg, yt-dlp, CPython 3.12 + faster-whisper/opencv/Pillow, Noto Sans Black, Next standalone. Whisper default `large-v3-turbo` downloads once into OS app-data. Recipients: chmod +x, double-click, paste `SRT-…` key. Check: `scripts/verify-desktop.sh`.
- Build: `node scripts/bundle-sidecars.mjs` then `CARGO_TARGET_DIR=src-tauri/target pnpm tauri:build`, then `scripts/package-linux.sh`. `scripts/prepare-tauri.mjs` copies Next standalone with `cp -a` so pnpm `.pnpm` links stay relative. Test the AppDir at `src-tauri/target/release/bundle/appimage/Sorotin.AppDir/AppRun` if the AppImage hits FUSE/tmpfs.
- License: Google Sheet + Apps Script (`license-appscript/`). Menu **Sorotin → Kunci baru**. App POSTs activate/heartbeat/deactivate; tab **Lisensi** / **Log**. One seat; `revoked` kills it. 7-day offline window. Web app URL is the app default. `/activate` when `SOROTIN_LICENSE_REQUIRED=1` or `SOROTIN_TAURI=1`. Browser `pnpm dev` does not require a key. Bypass: `SOROTIN_LICENSE_BYPASS=1`.
- Older Rust server in `license-server/` is unused.

**Still open:**
1. **macOS `.dmg` and Windows NSIS** via `.github/workflows/desktop.yml` (public repo, `workflow_dispatch` or `v*` tag). Sidecars in `scripts/bundle-sidecars.mjs` follow the runner OS. Unsigned Mac. No AI key in CI.
2. **First-run Whisper UI** + checksum; GPU/Metal path.
3. **AI key** in the OS keychain (Tauri stronghold), not plain JSON.
4. **linuxdeploy** AppImage path (FUSE / file mode 0770); currently finished with appimagetool.
5. **Product:** job queue, delete-studio, Range-streaming, export folder picker, auto-updater.

## 7. Git status at handoff

- The repo has 4 commits; last commit `9bc7737` (28 Oct 2026) "feat: AI settings + 9router model picker for clip ranking".
- **All work since then is uncommitted.** That covers robustness/upload, settings redesign, home redesign, scoring/hook, per-shot reframe, titles, the Sorotin rebrand and the studio polish.
- Run `git status` to see it.
- Suggested: review, then commit in a few logical commits (`data/` is gitignored).
