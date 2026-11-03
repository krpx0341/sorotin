import { spawn } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { proposeClips, type SceneCut, type SilenceGap } from "./clipper";
import {
  buildAssCaptions,
  captionBandHeight,
  defaultCaptionMarginV,
  wordsForClip,
} from "./captions";
import { captionFontDir, clipperPython, clipperScript, coverFont, pythonChildEnv } from "./tools";
import { whisperModel } from "./whisper";
import type {
  AspectRatio,
  ClipCandidate,
  RenderedClip,
  SkillPacks,
  SourceKind,
  Studio,
  TranscriptSegment,
} from "./types";
import { loadStudioRaw as loadStudio, mediaRoot, publicMediaUrl, saveStudio, studioDir } from "./store";
import { clipText, gradesFromParts, localHookLine, localScoring, localTitle } from "./scoring";
import { cleanStudioTitle } from "./title";
import {
  buildReframeGraph,
  captionPlacements,
  layoutGraph,
  parseSegments,
  segmentAt,
  type CoverPick,
  pickHookTop,
  type ReframeSegment,
} from "./reframe";
import {
  assertNotAborted,
  beginJob,
  endJob,
  JobAbortedError,
  trackChild,
} from "./jobs";

export { proposeClips } from "./clipper";

const jobContext = new AsyncLocalStorage<{ studioId: string }>();

function currentStudioId(): string | undefined {
  return jobContext.getStore()?.studioId;
}


function run(
  cmd: string,
  args: string[],
  opts: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    onStderr?: (chunk: string) => void;
    onStdout?: (chunk: string) => void;
    studioId?: string;
    /** Kill + reject after this many ms in total. */
    timeoutMs?: number;
    /** Kill + reject when the process prints nothing for this long (hung network etc.). */
    idleTimeoutMs?: number;
  } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const studioId = opts.studioId || currentStudioId();
    if (studioId) assertNotAborted(studioId);
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...pythonChildEnv(), ...opts.env } as NodeJS.ProcessEnv,
    });
    if (studioId) trackChild(studioId, child);
    let stdout = "";
    let stderr = "";
    let timedOut: string | null = null;
    const kill = (why: string) => {
      if (timedOut) return;
      timedOut = why;
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }, 3000).unref?.();
    };
    const total = opts.timeoutMs
      ? setTimeout(() => kill(`timeout setelah ${Math.round(opts.timeoutMs! / 1000)}s`), opts.timeoutMs)
      : null;
    let idle: NodeJS.Timeout | null = null;
    const touch = () => {
      if (!opts.idleTimeoutMs) return;
      if (idle) clearTimeout(idle);
      idle = setTimeout(
        () => kill(`tidak ada progress selama ${Math.round(opts.idleTimeoutMs! / 1000)}s`),
        opts.idleTimeoutMs,
      );
    };
    touch();
    const clearTimers = () => {
      if (total) clearTimeout(total);
      if (idle) clearTimeout(idle);
    };
    child.stdout.on("data", (d) => {
      const s = d.toString();
      stdout += s;
      if (opts.onStdout && stdout.length > 4_000_000) stdout = stdout.slice(-2_000_000);
      touch();
      opts.onStdout?.(s);
    });
    child.stderr.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
      touch();
      opts.onStderr?.(s);
    });
    child.on("error", (e) => {
      clearTimers();
      reject(e);
    });
    child.on("close", (code, signal) => {
      clearTimers();
      if (timedOut) {
        reject(new Error(`${cmd} dihentikan: ${timedOut}. ${stderr.slice(-400)}`));
        return;
      }
      if (studioId && (signal === "SIGTERM" || signal === "SIGKILL")) {
        reject(new JobAbortedError(studioId));
        return;
      }
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} failed (${code}): ${stderr.slice(-2000)}`));
    });
  });
}

function detectSource(link: string): SourceKind {
  const u = link.toLowerCase();
  if (u.includes("tiktok.com") || u.includes("vm.tiktok.com")) return "tiktok";
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  return "youtube";
}

export function validateSourceUrl(source: SourceKind, link: string): string | null {
  try {
    const u = new URL(link);
    if (!["http:", "https:"].includes(u.protocol)) return "URL harus http(s)";
    if (source === "youtube" && !(u.hostname.includes("youtube.com") || u.hostname.includes("youtu.be"))) {
      return "Link YouTube tidak valid";
    }
    if (source === "tiktok" && !(u.hostname.includes("tiktok.com"))) {
      return "Link TikTok tidak valid";
    }
    return null;
  } catch {
    return "URL tidak valid";
  }
}

async function probeDuration(mediaPath: string): Promise<number> {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    mediaPath,
  ]);
  const n = Number(stdout.trim());
  return Number.isFinite(n) ? n : 0;
}

function parseYtDlpPct(line: string): number | null {
  const m = line.match(/(\d{1,3}(?:\.\d+)?)%/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? Math.min(100, n) : null;
}

/** Map raw yt-dlp stderr to an actionable message (Indonesian UI). */
export function friendlyDownloadError(raw: string): string {
  const t = raw.toLowerCase();
  if (t.includes("sign in to confirm") || t.includes("not a bot"))
    return "YouTube minta login/verifikasi bot. Download videonya manual lalu pakai Upload / path file lokal.";
  if (t.includes("private video")) return "Video private — tidak bisa didownload.";
  if (t.includes("video unavailable") || t.includes("has been removed"))
    return "Video tidak tersedia (dihapus / dibatasi wilayah).";
  if (t.includes("age") && t.includes("restrict")) return "Video dibatasi umur — perlu login. Pakai Upload.";
  if (t.includes("http error 403")) return "Server menolak download (403). Coba lagi nanti atau pakai Upload.";
  if (t.includes("http error 429")) return "Kena rate-limit (429). Tunggu sebentar atau pakai Upload.";
  if (t.includes("tidak ada progress") || t.includes("timeout"))
    return "Download macet/timeout (jaringan). Coba lagi atau pakai Upload.";
  if (t.includes("unable to download") || t.includes("network") || t.includes("timed out"))
    return "Gagal download (jaringan). Coba lagi atau pakai Upload.";
  const line = raw.split("\n").reverse().find((l) => /error/i.test(l)) || raw.slice(-200);
  return `Download gagal: ${line.replace(/^.*?ERROR:\s*/i, "").slice(0, 200)}`;
}

/** Errors where retrying cannot help. */
function isPermanentDownloadError(raw: string) {
  return /private video|video unavailable|has been removed|sign in to confirm|not a bot|age.restrict|unsupported url/i.test(
    raw,
  );
}

async function downloadUrl(
  link: string,
  outDir: string,
  onProgress?: (pct: number, message: string) => void,
): Promise<{ mediaPath: string; title: string }> {
  const attempts = Number(process.env.PERSONAL_CLIPPER_DOWNLOAD_ATTEMPTS || 3);
  let lastErr = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await downloadUrlOnce(link, outDir, onProgress);
    } catch (e) {
      if (e instanceof JobAbortedError) throw e;
      lastErr = e instanceof Error ? e.message : String(e);
      if (isPermanentDownloadError(lastErr) || attempt === attempts) break;
      onProgress?.(0, `Download gagal, coba lagi (${attempt + 1}/${attempts})…`);
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  throw new Error(friendlyDownloadError(lastErr));
}

async function downloadUrlOnce(
  link: string,
  outDir: string,
  onProgress?: (pct: number, message: string) => void,
): Promise<{ mediaPath: string; title: string }> {
  fs.mkdirSync(outDir, { recursive: true });
  const template = path.join(outDir, "source.%(ext)s");
  // Prefer 720p progressive/merged — much faster than 1080p dual-stream merge.
  const format =
    process.env.PERSONAL_CLIPPER_FORMAT ||
    "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/bv*[height<=720]+ba/b[height<=720]/b";

  await run(
    "yt-dlp",
    [
      "-f",
      format,
      "--merge-output-format",
      "mp4",
      "-o",
      template,
      "--no-playlist",
      "--no-mtime",
      "--newline",
      "--concurrent-fragments",
      process.env.PERSONAL_CLIPPER_FRAGMENTS || "8",
      "--retries",
      "5",
      "--fragment-retries",
      "5",
      "--socket-timeout",
      "30",
      "--write-info-json",
      "--no-write-comments",
      "--no-write-thumbnail",
      link,
    ],
    {
      // Whole download hard cap (default 45 min) + stall detection (default 3 min silent).
      timeoutMs: Number(process.env.PERSONAL_CLIPPER_DOWNLOAD_TIMEOUT_SEC || 2700) * 1000,
      idleTimeoutMs: Number(process.env.PERSONAL_CLIPPER_DOWNLOAD_IDLE_SEC || 180) * 1000,
      onStdout: (chunk) => {
        for (const line of chunk.split("\n")) {
          const pct = parseYtDlpPct(line);
          if (pct != null) onProgress?.(pct, line.trim().slice(0, 120));
        }
      },
      onStderr: (chunk) => {
        for (const line of chunk.split("\n")) {
          const pct = parseYtDlpPct(line);
          if (pct != null) onProgress?.(pct, line.trim().slice(0, 120));
        }
      },
    },
  );

  const files = fs.readdirSync(outDir);
  const media = files.find((f) => /\.(mp4|mkv|webm|mov)$/i.test(f));
  if (!media) throw new Error("Download selesai tapi file video tidak ketemu");
  const infoName = files.find((f) => f.endsWith(".info.json"));
  let title = path.parse(media).name;
  if (infoName) {
    try {
      const info = JSON.parse(fs.readFileSync(path.join(outDir, infoName), "utf8"));
      if (info.title) title = String(info.title);
    } catch {
      /* ignore */
    }
  }
  return { mediaPath: path.join(outDir, media), title };
}

async function extractAudio(mediaPath: string, audioPath: string) {
  await run("ffmpeg", [
    "-y",
    "-i",
    mediaPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    audioPath,
  ]);
}

async function detectSilences(audioPath: string): Promise<SilenceGap[]> {
  try {
    const { stderr } = await run("ffmpeg", [
      "-hide_banner",
      "-i",
      audioPath,
      "-af",
      "silencedetect=noise=-30dB:d=0.45",
      "-f",
      "null",
      "-",
    ]);
    const starts: number[] = [];
    const ends: number[] = [];
    for (const line of stderr.split("\n")) {
      const s = line.match(/silence_start:\s*([0-9.]+)/);
      if (s) starts.push(Number(s[1]));
      const e = line.match(/silence_end:\s*([0-9.]+)/);
      if (e) ends.push(Number(e[1]));
    }
    const gaps: SilenceGap[] = [];
    const n = Math.min(starts.length, ends.length);
    for (let i = 0; i < n; i++) {
      if (ends[i] > starts[i]) gaps.push({ start: starts[i], end: ends[i] });
    }
    return gaps;
  } catch {
    return [];
  }
}

async function detectScenes(mediaPath: string, durationSec: number): Promise<SceneCut[]> {
  // Cap analysis window for long videos — first 20 min is enough for clip hunting seed.
  const analyzeTo = Math.min(durationSec || 1200, 1200);
  try {
    const { stderr } = await run("ffmpeg", [
      "-hide_banner",
      "-ss",
      "0",
      "-t",
      String(analyzeTo),
      "-i",
      mediaPath,
      "-filter:v",
      "select='gt(scene,0.32)',showinfo",
      "-vsync",
      "vfr",
      "-f",
      "null",
      "-",
    ]);
    const cuts: SceneCut[] = [];
    for (const line of stderr.split("\n")) {
      const m = line.match(/pts_time:([0-9.]+)/);
      if (m) cuts.push({ at: Number(m[1]) });
    }
    return cuts.slice(0, 80);
  } catch {
    return [];
  }
}

async function transcribe(audioPath: string, language: SkillPacks["captionLanguage"]): Promise<{
  language: string;
  duration: number;
  segments: TranscriptSegment[];
}> {
  const script = clipperScript("transcribe.py");
  const model = whisperModel();
  const { stdout } = await run(clipperPython(), [
    script,
    audioPath,
    "--language",
    language,
    "--model",
    model,
  ]);
  return JSON.parse(stdout);
}


function escapeAssPath(p: string) {
  // ffmpeg ass/subtitles filter path escaping
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

type FacePoint = { cx: number; cy: number; faceW: number; faceH: number };

type FaceCropResult = FacePoint & {
  confidence: number;
  faces: FacePoint[];
  speakerCount: 1 | 2;
  /** Scene-aware plan (empty → legacy static crop). */
  segments: ReframeSegment[];
  cover: CoverPick | null;
  /** Seconds of flash frames (another shot) face_track cut off the clip start/end. */
  trimStart?: number;
  trimEnd?: number;
};

/** How long the hook card stays on screen (fades out at the end). */
const HOOK_SECONDS = Number(process.env.PERSONAL_CLIPPER_HOOK_SEC || 3.5);

/** One-line warning. The Python stderr (install hint, missing model) is appended. */
export function faceTrackFailureWarning(detail: string): string {
  const oneLine = detail.replace(/\s+/g, " ").trim().slice(0, 600);
  return `face_track gagal, render dilanjutkan dengan crop tengah. ${oneLine}`;
}

/** Center crop used when face_track exits non-zero or returns nothing usable. */
export function centerFaceFallback(): FaceCropResult {
  return {
    cx: 0.5,
    cy: 0.38,
    confidence: 0,
    faceW: 0.2,
    faceH: 0.25,
    faces: [{ cx: 0.5, cy: 0.38, faceW: 0.2, faceH: 0.25 }],
    speakerCount: 1,
    segments: [],
    cover: null,
  };
}

/**
 * face_track failed. A stopped job must still abort the render; every other failure
 * logs a warning and returns a center crop (empty segments → renderClip's center path).
 */
export function settleFaceTrackError(e: unknown): FaceCropResult {
  if (e instanceof JobAbortedError) throw e;
  const detail = e instanceof Error ? e.message : String(e);
  console.warn(`[face] ${faceTrackFailureWarning(detail)}`);
  return centerFaceFallback();
}

export async function faceCropCenter(
  mediaPath: string,
  start: number,
  end: number,
  out: { w: number; h: number; allowDual: boolean },
): Promise<FaceCropResult> {
  const script = clipperScript("face_track.py");
  try {
    const { stdout } = await run(clipperPython(), [
      script,
      mediaPath,
      "--start",
      String(start),
      "--end",
      String(end),
      "--step",
      "0.5",
      "--out-w",
      String(out.w),
      "--out-h",
      String(out.h),
      ...(out.allowDual ? ["--allow-dual"] : []),
    ]);
    const j = JSON.parse(stdout) as {
      cx?: number;
      cy?: number;
      confidence?: number;
      face_w?: number;
      face_h?: number;
      faces?: Array<{ cx?: number; cy?: number; face_w?: number; face_h?: number }>;
      speaker_count?: number;
      segments?: unknown;
      cover?: { t?: number; segment?: number; score?: number };
      trim_start?: number;
      trim_end?: number;
    };
    const trim = (n: unknown) => (Number.isFinite(Number(n)) ? Math.min(0.25, Math.max(0, Number(n))) : 0);
    const clamp01 = (n: number, d: number) =>
      Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : d;
    const facesRaw = Array.isArray(j.faces) ? j.faces : [];
    const faces: FacePoint[] = facesRaw
      .map((f) => ({
        cx: clamp01(Number(f.cx), 0.5),
        cy: clamp01(Number(f.cy), 0.38),
        faceW: Number.isFinite(Number(f.face_w)) ? Number(f.face_w) : 0.2,
        faceH: Number.isFinite(Number(f.face_h)) ? Number(f.face_h) : 0.25,
      }))
      .slice(0, 2);
    const cx = clamp01(Number(j.cx), 0.5);
    const cy = clamp01(Number(j.cy), 0.38);
    const faceW = Number.isFinite(Number(j.face_w)) ? Number(j.face_w) : 0.2;
    const faceH = Number.isFinite(Number(j.face_h)) ? Number(j.face_h) : 0.25;
    if (!faces.length) {
      faces.push({ cx, cy, faceW, faceH });
    }
    const speakerCount: 1 | 2 =
      Number(j.speaker_count) >= 2 && faces.length >= 2 ? 2 : 1;
    return {
      cx,
      cy,
      confidence: Number(j.confidence ?? 0),
      faceW,
      faceH,
      faces: speakerCount === 2 ? faces.slice(0, 2) : faces.slice(0, 1),
      speakerCount,
      segments: parseSegments(j.segments, out.allowDual),
      trimStart: trim(j.trim_start),
      trimEnd: trim(j.trim_end),
      cover:
        j.cover && Number.isFinite(Number(j.cover.t))
          ? {
              t: Number(j.cover.t),
              segment: Math.max(0, Math.round(Number(j.cover.segment) || 0)),
              score: Number(j.cover.score) || 0,
            }
          : null,
    };
  } catch (e) {
    return settleFaceTrackError(e);
  }
}

/** Crop x/y expression centered on face; headroomFrac ~0.30 full-frame, ~0.35 half. */
function faceCropXY(w: number, h: number, cx: number, cy: number, headroomFrac: number) {
  const cxs = cx.toFixed(4);
  const cys = cy.toFixed(4);
  // Commas escaped as \, for ffmpeg filtergraph (written as \\, in JS template → \, in output)
  const x = `max(0\\,min(iw-${w}\\,iw*${cxs}-${w}/2))`;
  const y = `max(0\\,min(ih-${h}\\,ih*${cys}-${h}*${headroomFrac.toFixed(2)}))`;
  return { x, y };
}

/** Greedy-wrap cover title into up to `maxLines` lines; ellipsis only if it truly overflows. */
export function splitCoverTitle(title: string, maxPerLine = 20, maxLines = 3): string[] {
  const t = title.replace(/\s+/g, " ").trim();
  if (!t) return ["CLIP"];
  const lines: string[] = [];
  let cur = "";
  for (const word of t.split(" ")) {
    const next = cur ? `${cur} ${word}` : word;
    if (next.length > maxPerLine && cur) {
      lines.push(cur);
      cur = word;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1]}…`;
    return kept;
  }
  return lines;
}

function aspectSize(aspect: AspectRatio): { w: number; h: number } {
  if (aspect === "9:16") return { w: 1080, h: 1920 };
  if (aspect === "1:1") return { w: 1080, h: 1080 };
  return { w: 1920, h: 1080 };
}


function escapeDrawtext(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/%/g, "\\%");
}

async function renderClip(
  studio: Studio,
  clip: ClipCandidate,
  skills: SkillPacks,
  aspect: AspectRatio,
): Promise<RenderedClip> {
  if (!studio.mediaPath) throw new Error("media missing");
  const outDir = path.join(studioDir(studio.id), "clips", clip.id);
  fs.mkdirSync(outDir, { recursive: true });
  const { w, h } = aspectSize(aspect);
  const outPath = path.join(outDir, `${aspect.replace(":", "x")}.mp4`);
  const coverPath = path.join(outDir, "cover.jpg");
  const assPath = path.join(outDir, "captions.ass");

  const face =
    skills.autoReframe || skills.smartCover
      ? await faceCropCenter(studio.mediaPath, clip.start, clip.end, {
          w,
          h,
          // Opus-style top/bottom split only makes sense for vertical output.
          allowDual: aspect === "9:16",
        })
      : null;
  // A hard cut in the first/last 0.2s = a flash frame of the neighbouring shot (e.g. one
  // frame of another camera under this shot's crop). face_track already dropped it from
  // its plan (segment times are relative to the trimmed start); move the clip edges to match.
  if (face && (face.trimStart || face.trimEnd)) {
    clip = {
      ...clip,
      start: Number((clip.start + (face.trimStart || 0)).toFixed(3)),
      end: Number((clip.end - (face.trimEnd || 0)).toFixed(3)),
    };
  }

  // Scene-aware plan: per-shot single / dual / center crops.
  const segments = skills.autoReframe && face?.segments.length ? face.segments : [];

  // Overlay filters shared by -vf and filter_complex paths (hook + captions).
  const overlayParts: string[] = [];
  // Hook card: real-font measured PNG (wraps 1–3 lines, shrinks to fit 88% width).
  let hookPng: string | null = null;
  let hookY = 0;
  if (skills.smartHook) {
    const hookText = clip.hook || localHookLine(clip.title, studio.transcript || [], clip.start, clip.end);
    const pngPath = path.join(outDir, "hook.png");
    try {
      const { stdout } = await run(clipperPython(), [
        clipperScript("hook_card.py"),
        "--text",
        hookText,
        "--frame-w",
        String(w),
        "--frame-h",
        String(h),
        "--out",
        pngPath,
        "--font",
        coverFont(),
        "--style",
        skills.hookStyle || "classic",
      ]);
      const meta = JSON.parse(stdout) as { w: number; h: number };
      if (meta.w > 0 && meta.w <= w) {
        hookPng = pngPath;
        // Below platform top UI (TikTok/Reels bar ≈ 7–8% of height), but never over a face.
        const top = pickHookTop(segments, {
          cardH: meta.h / h,
          cardW: meta.w / w,
          hookSec: HOOK_SECONDS,
          preferTop: h > w ? 0.085 : 0.05,
        });
        hookY = Math.round(h * top);
      }
    } catch (e) {
      if (e instanceof JobAbortedError) throw e;
      console.error(`[hook] ${clip.id}:`, e instanceof Error ? e.message.slice(-300) : e);
    }
  }

  if (skills.captions && studio.transcript?.length) {
    const words = wordsForClip(studio.transcript, clip.start, clip.end);
    if (words.length) {
      fs.writeFileSync(
        assPath,
        buildAssCaptions({
          words,
          playResX: w,
          playResY: h,
          clipStart: clip.start,
          placements: segments.length
            ? captionPlacements(segments, {
                playResY: h,
                defaultMarginV: defaultCaptionMarginV(h),
                bandH: captionBandHeight(h, 2),
              })
            : undefined,
        }),
        "utf8",
      );
      const fontsEsc = captionFontDir().replace(/\\/g, "\\\\").replace(/:/g, "\\:");
      overlayParts.push(`ass='${escapeAssPath(assPath)}':fontsdir='${fontsEsc}'`);
    }
  }

  const ffmpegIn = [
    "-y",
    "-ss",
    String(clip.start),
    "-to",
    String(clip.end),
    "-i",
    studio.mediaPath,
    ...(hookPng ? ["-loop", "1", "-framerate", "30", "-t", String(HOOK_SECONDS), "-i", hookPng] : []),
  ];

  let fc: string;
  if (segments.length) {
    fc = buildReframeGraph(segments, w, h);
  } else {
    // No shot plan (face_track failed, or it returned no segments): center crop.
    const vfParts: string[] = [];
    if (skills.autoReframe && face) {
      const { x, y } = faceCropXY(w, h, face.cx, face.cy, 0.3);
      vfParts.push(`scale=${w}:${h}:force_original_aspect_ratio=increase`, `crop=${w}:${h}:${x}:${y}`);
    } else {
      vfParts.push(
        `scale=${w}:${h}:force_original_aspect_ratio=decrease`,
        `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`,
      );
    }
    fc = `[0:v]${vfParts.join(",")}[base]`;
  }
  let last = "base";
  overlayParts.forEach((part, i) => {
    fc += `;[${last}]${part}[ov${i}]`;
    last = `ov${i}`;
  });
  if (hookPng) {
    const fadeOut = Math.max(0.5, HOOK_SECONDS - 0.3).toFixed(2);
    fc +=
      // Fully opaque from frame 0: the hook is the scroll-stopper, a fade-in made it read
      // faint on light backgrounds for the first ~0.25s.
      `;[1:v]format=rgba,fade=t=out:st=${fadeOut}:d=0.3:alpha=1[hk]` +
      `;[${last}][hk]overlay=x=(W-w)/2:y=${hookY}:eof_action=pass:format=auto[hko]`;
    last = "hko";
  }
  fc += `;[${last}]null[vout]`;
  await run("ffmpeg", [
    ...ffmpegIn,
    "-filter_complex",
    fc,
    "-map",
    "[vout]",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    outPath,
  ]);

  let coverOk = false;
  if (skills.smartCover) {
    // Cover failure must not throw away an already-rendered clip.
    try {
      await renderSmartCover({
        mediaPath: studio.mediaPath,
        coverPath,
        clip,
        w,
        h,
        face,
        segments,
        autoReframe: skills.autoReframe,
      });
      coverOk = true;
    } catch (e) {
      if (e instanceof JobAbortedError) throw e;
      console.error(`[cover] ${clip.id}:`, e instanceof Error ? e.message.slice(-400) : e);
    }
  }

  return {
    ...clip,
    status: "ready",
    previewPath: publicMediaUrl(outPath),
    exportPaths: { [aspect]: publicMediaUrl(outPath) },
    coverPath: coverOk ? publicMediaUrl(coverPath) : undefined,
  };
}

async function renderSmartCover(opts: {
  mediaPath: string;
  coverPath: string;
  clip: ClipCandidate;
  w: number;
  h: number;
  face: FaceCropResult | null;
  segments: ReframeSegment[];
  autoReframe: boolean;
}) {
  const { mediaPath, coverPath, clip, w, h, face, segments, autoReframe } = opts;
  const dur = clip.end - clip.start;
  // Best-scored moment (eyes open, sharp, face present) from face_track; else start+2s.
  const relT =
    face?.cover && face.cover.t >= 0 && face.cover.t < dur ? face.cover.t : Math.min(2, dur / 3);
  const ss = clip.start + relT;
  const seg = segments.length ? segments[segmentAt(segments, relT)] : null;
  const useDual = seg?.layout === "dual";
  const fontEsc = coverFont().replace(/\\/g, "\\\\").replace(/:/g, "\\:");
  let perLine = aspectSizeLines(w, h);
  let lines = splitCoverTitle(clip.hook || clip.title, perLine);
  // Never truncate the headline: widen lines (font auto-shrinks below) until it fits 3 lines.
  while (lines[lines.length - 1].endsWith("…") && perLine < 32) {
    perLine += 3;
    lines = splitCoverTitle(clip.hook || clip.title, perLine);
  }
  // Auto-fit: Noto Black averages ~0.6em per glyph; keep lines inside ~88% width.
  const longest = Math.max(...lines.map((l) => l.length), 1);
  const titleFs = Math.max(
    40,
    Math.min(Math.round(h * 0.05), Math.floor((w * 0.88) / (longest * 0.6))),
  );
  const lineGap = Math.round(titleFs * 1.2);
  const pad = Math.round(titleFs * 0.55);
  const bandH = pad * 2 + lineGap * (lines.length - 1) + titleFs;
  // Dual split: band sits on the seam (between the two faces).
  // Single: band in the lower third, above platform UI.
  const bandTop = useDual
    ? Math.round(h / 2 - bandH / 2)
    : Math.round(h - bandH - h * 0.08);
  const barH = Math.max(8, Math.round(h * 0.006));
  // The cover is what viewers see on TikTok/Reels: an app-internal virality score does not
  // belong there (the studio grid shows it as a badge). Opt back in with the env flag.
  const scoreLabel =
    process.env.PERSONAL_CLIPPER_COVER_SCORE === "1" && clip.scoring?.source === "ai"
      ? escapeDrawtext(String(clip.scoring.score))
      : "";

  const titleDraws: string[] = [];
  lines.forEach((line, i) => {
    const y = bandTop + pad + i * lineGap;
    titleDraws.push(
      `drawtext=fontfile=${fontEsc}:text='${escapeDrawtext(line)}':fontsize=${titleFs}:fontcolor=white:borderw=4:bordercolor=black@0.85:x=(w-text_w)/2:y=${y}`,
    );
  });
  // Scrim band + emerald accent bars + score chip
  const decor = [
    // drawbox: w/h are the box's own size — use iw/ih for the frame.
    `drawbox=x=0:y=${bandTop}:w=iw:h=${bandH}:color=black@0.68:t=fill`,
    `drawbox=x=0:y=${bandTop}:w=iw:h=${barH}:color=0x10B981@1:t=fill`,
    `drawbox=x=0:y=${bandTop + bandH - barH}:w=iw:h=${barH}:color=0x10B981@1:t=fill`,
    ...(scoreLabel
      ? [
          `drawtext=fontfile=${fontEsc}:text='${scoreLabel}':fontsize=${Math.round(h * 0.028)}:fontcolor=black:box=1:boxcolor=0x10B981@0.95:boxborderw=10:x=w*0.06:y=h*0.045`,
        ]
      : []),
  ];

  if (seg) {
    // Same layout (single/dual/center) as the segment this moment belongs to.
    const fc =
      layoutGraph(seg, w, h, "[0:v]", "base", "c") +
      `;[base]${decor.concat(titleDraws).join(",")}[vout]`;
    await run("ffmpeg", [
      "-y",
      "-ss",
      String(ss),
      "-i",
      mediaPath,
      "-frames:v",
      "1",
      "-filter_complex",
      fc,
      "-map",
      "[vout]",
      "-q:v",
      "2",
      coverPath,
    ]);
    return;
  }

  const base: string[] = [];
  if (autoReframe && face) {
    const { x, y } = faceCropXY(w, h, face.cx, face.cy, 0.3);
    base.push(
      `scale=${w}:${h}:force_original_aspect_ratio=increase`,
      `crop=${w}:${h}:${x}:${y}`,
    );
  } else {
    base.push(
      `scale=${w}:${h}:force_original_aspect_ratio=decrease`,
      `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`,
    );
  }
  const vf = [...base, ...decor, ...titleDraws].join(",");
  await run("ffmpeg", [
    "-y",
    "-ss",
    String(ss),
    "-i",
    mediaPath,
    "-frames:v",
    "1",
    "-vf",
    vf,
    "-q:v",
    "2",
    coverPath,
  ]);
}

function aspectSizeLines(w: number, h: number): number {
  // Slightly wider lines on landscape covers
  return h >= w ? 20 : 36;
}

export async function processStudio(studioId: string) {
  const studio = loadStudio(studioId);
  if (!studio) throw new Error("studio not found");
  const signal = beginJob(studioId);

  const bump = (patch: Partial<Studio>) => {
    assertNotAborted(studioId);
    const next = { ...loadStudio(studioId)!, ...patch, updatedAt: new Date().toISOString() };
    saveStudio(next);
    return next;
  };

  try {
    await jobContext.run({ studioId }, async () => {
    let current = studio;
    const work = path.join(studioDir(studioId), "source");
    fs.mkdirSync(work, { recursive: true });

    if (!current.mediaPath) {
      bump({ status: "downloading", progress: { pct: 1, message: "Menyiapkan download…" }, error: undefined });
      if (current.source === "upload") {
        if (!current.sourceUrl) throw new Error("upload path missing");
        current = bump({
          mediaPath: current.sourceUrl,
          progress: { pct: 20, message: "Upload lokal siap" },
        });
      } else {
        if (!current.sourceUrl) throw new Error("link missing");
        let lastPct = 0;
        const dl = await downloadUrl(current.sourceUrl, work, (pct, message) => {
          // Map yt-dlp 0–100 into overall 5–35.
          const mapped = Math.max(lastPct, Math.round(5 + pct * 0.3));
          lastPct = mapped;
          bump({
            status: "downloading",
            progress: { pct: mapped, message: message || `Download ${pct.toFixed(0)}%` },
          });
        });
        current = bump({
          mediaPath: dl.mediaPath,
          title: current.title === "Untitled" || !current.title ? dl.title : current.title,
          progress: { pct: 35, message: "Download selesai" },
        });
      }
    }

    const durationSec = await probeDuration(current.mediaPath!);
    current = bump({ durationSec, progress: { pct: 38, message: `Durasi ${Math.round(durationSec)}s` } });

    const audioPath = path.join(studioDir(studioId), "audio.wav");
    bump({ status: "transcribing", progress: { pct: 42, message: "Ekstrak audio…" } });
    await extractAudio(current.mediaPath!, audioPath);
    bump({ progress: { pct: 48, message: `Whisper ${whisperModel()}…` } });
    const tr = await transcribe(audioPath, current.skills.captionLanguage);
    current = bump({
      audioPath,
      transcript: tr.segments,
      durationSec: tr.duration || durationSec,
      progress: { pct: 62, message: `${tr.segments.length} segmen transcript` },
    });

    bump({ status: "clipping", progress: { pct: 66, message: "Deteksi silence + scene…" } });
    const [silences, scenes] = await Promise.all([
      detectSilences(audioPath),
      detectScenes(current.mediaPath!, current.durationSec || durationSec),
    ]);
    const targetSec = Number(current.targetSec || process.env.PERSONAL_CLIPPER_TARGET_SEC || 40);
    const maxClips = Number(process.env.PERSONAL_CLIPPER_MAX_CLIPS || 8);
    let candidates: ClipCandidate[] = [];
    let clipSource = "local";
    let ranking: NonNullable<Studio["ranking"]> = { source: "local" };
    try {
      const { loadAiSettings } = await import("./ai-settings");
      const aiSettings = loadAiSettings();
      if (aiSettings.enabled && aiSettings.model && (current.transcript || []).length) {
        bump({ progress: { pct: 68, message: `AI ranking (${aiSettings.model})…` } });
        const { rankClipsWithAi } = await import("./ai");
        candidates = await rankClipsWithAi(current.transcript || [], current.durationSec || durationSec, {
          targetSec,
          maxClips,
        });
        clipSource = "ai";
        ranking = { source: "ai", model: aiSettings.model };
      } else if (aiSettings.enabled && !aiSettings.model) {
        ranking = { source: "local", error: "AI aktif tapi model belum dipilih di Settings" };
      }
    } catch (e) {
      const { loadAiSettings } = await import("./ai-settings");
      ranking = {
        source: "local",
        model: loadAiSettings().model || undefined,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      };
      bump({
        progress: {
          pct: 69,
          message: `AI gagal, fallback lokal: ${e instanceof Error ? e.message.slice(0, 80) : "error"}`,
        },
      });
    }
    if (!candidates.length) {
      candidates = proposeClips(current.transcript || [], current.durationSec || durationSec, {
        targetSec,
        maxClips,
        silences,
        scenes,
      });
      clipSource = "local";
    }
    candidates = (await ensureScoring(candidates, current.transcript || [])).clips;
    current = bump({
      ...(await ensureStudioTitle(current, candidates.map((c) => c.title))),
      ranking,
      clips: candidates.map((c) => ({ ...c, status: "pending" as const })),
      status: "rendering",
      progress: { pct: 72, message: `Render ${candidates.length} clip (${clipSource})…` },
    });

    const rendered: RenderedClip[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      try {
        rendered.push(await renderClip(current, c, current.skills, current.exportAspect));
      } catch (e) {
        if (e instanceof JobAbortedError) throw e;
        rendered.push({
          ...c,
          status: "error",
          error: e instanceof Error ? e.message : String(e),
        });
      }
      const pct = 72 + Math.round(((i + 1) / Math.max(1, candidates.length)) * 26);
      bump({
        clips: [
          ...rendered,
          ...candidates.slice(rendered.length).map((x) => ({ ...x, status: "pending" as const })),
        ],
        progress: { pct, message: `Render clip ${i + 1}/${candidates.length}` },
      });
    }

    bump({
      clips: rendered,
      status: "ready",
      progress: { pct: 100, message: "Selesai" },
    });
    });
  } catch (e) {
    if (e instanceof JobAbortedError || signal.aborted) {
      const cur = loadStudio(studioId);
      if (cur) {
        saveStudio({
          ...cur,
          status: "error",
          error: "Stopped",
          progress: { pct: cur.progress?.pct ?? 0, message: "Stopped" },
          updatedAt: new Date().toISOString(),
        });
      }
    } else {
      try {
        bump({
          status: "error",
          error: e instanceof Error ? e.message : String(e),
          progress: { pct: 100, message: "Gagal" },
        });
      } catch {
        const cur = loadStudio(studioId);
        if (cur) {
          saveStudio({
            ...cur,
            status: "error",
            error: e instanceof Error ? e.message : String(e),
            progress: { pct: 100, message: "Gagal" },
            updatedAt: new Date().toISOString(),
          });
        }
      }
    }
  } finally {
    endJob(studioId, signal);
  }
}


/** Re-render existing clip windows (keeps transcript + clip cuts). */
/** Local, labelled estimate + local hook line (used when AI is off or fails). */
function scoreLocally(c: ClipCandidate, transcript: TranscriptSegment[]): ClipCandidate {
  const scoring = localScoring(transcript, c.start, c.end);
  return {
    ...c,
    scoring,
    score: Number((scoring.score / 100).toFixed(3)),
    grades: gradesFromParts(scoring.parts),
    reason: scoring.reasons.join(" · ") || c.reason,
    hook: c.hook || localHookLine(c.title, transcript, c.start, c.end),
  };
}

/**
 * Make sure every clip has an honest score + hook. When AI is configured, clips without an
 * AI grade are graded in one call; anything left falls back to the local estimate.
 */
async function ensureScoring(
  clips: ClipCandidate[],
  transcript: TranscriptSegment[],
): Promise<{ clips: ClipCandidate[]; note: string }> {
  const { loadAiSettings } = await import("./ai-settings");
  const ai = loadAiSettings();
  let out = clips;
  let note = "lokal";
  // AI grades clips without an AI score, and writes titles for clips whose title is still
  // raw transcript text (never for a title the user renamed).
  const wantsTitle = (c: ClipCandidate) => !c.titleEdited && c.titleSource !== "ai";
  const needAi = clips.filter((c) => c.scoring?.source !== "ai" || wantsTitle(c));
  if (clips.length && !needAi.length) note = `AI (${ai.model || "tersimpan"})`;
  if (ai.enabled && ai.model && needAi.length && transcript.length) {
    try {
      const { scoreClipsWithAi } = await import("./ai");
      const graded = await scoreClipsWithAi(
        needAi.map((c) => ({ id: c.id, start: c.start, end: c.end, title: c.title, text: clipText(transcript, c.start, c.end) })),
      );
      out = clips.map((c) => {
        const g = graded.get(c.id);
        if (!g) return c;
        const titled = wantsTitle(c) && g.title ? { title: g.title, titleSource: "ai" as const } : {};
        // Keep an existing AI grade stable across re-renders; only fill the title/hook.
        if (c.scoring?.source === "ai") return { ...c, ...titled, hook: c.hook || g.hook || undefined };
        return {
          ...c,
          ...titled,
          scoring: g.scoring,
          grades: g.grades,
          score: Number((g.scoring.score / 100).toFixed(3)),
          reason: g.scoring.reasons.join(" · ") || c.reason,
          hook: g.hook || c.hook,
        };
      });
      note = `AI (${ai.model})`;
    } catch (e) {
      if (e instanceof JobAbortedError) throw e;
      note = `lokal — AI gagal: ${e instanceof Error ? e.message.slice(0, 80) : "error"}`;
    }
  }
  out = out.map((c) => (c.scoring ? { ...c, hook: c.hook || localHookLine(c.title, transcript, c.start, c.end) } : scoreLocally(c, transcript)));
  // Raw transcript titles ("Kayaknya lumayan apa ya?") → cleaned whole-sentence title.
  out = out.map((c) =>
    c.titleEdited || c.titleSource ? c : { ...c, title: localTitle(c.title, transcript, c.start, c.end), titleSource: "local" as const },
  );
  return { clips: out, note };
}

/**
 * Display title for the studio header. Never touches a user rename; upgrades a cleaned
 * local title to an AI one when AI is configured. Never throws.
 */
async function ensureStudioTitle(s: Studio, clipTitles: string[]): Promise<Partial<Studio>> {
  if (s.displayTitleSource === "user" || s.displayTitleSource === "ai") return {};
  const local: Partial<Studio> = { displayTitle: cleanStudioTitle(s.title), displayTitleSource: "local" };
  try {
    const { loadAiSettings } = await import("./ai-settings");
    const ai = loadAiSettings();
    if (!ai.enabled || !ai.model || !s.title) return local;
    const { studioTitleWithAi } = await import("./ai");
    const t = await studioTitleWithAi(s.title, clipTitles);
    return t ? { displayTitle: t, displayTitleSource: "ai" } : local;
  } catch (e) {
    if (e instanceof JobAbortedError) throw e;
    return local;
  }
}

export async function rerenderStudio(studioId: string) {
  const studio = loadStudio(studioId);
  if (!studio) throw new Error("studio not found");
  if (!studio.mediaPath) throw new Error("media missing");
  if (!studio.clips?.length) throw new Error("no clips to render");
  const signal = beginJob(studioId);

  const bump = (patch: Partial<Studio>) => {
    assertNotAborted(studioId);
    const next = { ...loadStudio(studioId)!, ...patch, updatedAt: new Date().toISOString() };
    saveStudio(next);
    return next;
  };

  try {
    await jobContext.run({ studioId }, async () => {
      const current = bump({
        status: "rendering",
        error: undefined,
        progress: { pct: 5, message: `Re-render ${studio.clips.length} clip…` },
      });
      const base: ClipCandidate[] = studio.clips.map((c) => {
        const { status: _st, error: _err, ...rest } = c;
        void _st;
        void _err;
        return rest;
      });
      bump({ progress: { pct: 3, message: "Skor + hook clip…" } });
      const scored = await ensureScoring(base, current.transcript || []);
      bump(await ensureStudioTitle(current, scored.clips.map((c) => c.title)));
      const candidates = scored.clips.map((c) => ({ ...c, status: "pending" as const }));
      bump({ progress: { pct: 5, message: `Re-render ${candidates.length} clip (skor ${scored.note})…` } });
      const rendered: RenderedClip[] = [];
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        try {
          rendered.push(await renderClip(current, c, current.skills, current.exportAspect));
        } catch (e) {
          if (e instanceof JobAbortedError) throw e;
          rendered.push({
            ...c,
            status: "error",
            error: e instanceof Error ? e.message : String(e),
          });
        }
        const pct = 5 + Math.round(((i + 1) / Math.max(1, candidates.length)) * 90);
        bump({
          clips: [
            ...rendered,
            ...candidates.slice(rendered.length).map((x) => ({ ...x, status: "pending" as const })),
          ],
          progress: { pct, message: `Render clip ${i + 1}/${candidates.length}` },
        });
      }
      bump({
        clips: rendered,
        status: "ready",
        progress: { pct: 100, message: "Selesai" },
      });
    });
  } catch (e) {
    if (e instanceof JobAbortedError || signal.aborted) {
      const cur = loadStudio(studioId);
      if (cur) {
        saveStudio({
          ...cur,
          status: "error",
          error: "Stopped",
          progress: { pct: cur.progress?.pct ?? 0, message: "Stopped" },
          updatedAt: new Date().toISOString(),
        });
      }
    } else {
      const cur = loadStudio(studioId);
      if (cur) {
        saveStudio({
          ...cur,
          status: "error",
          error: e instanceof Error ? e.message : String(e),
          progress: { pct: 100, message: "Gagal" },
          updatedAt: new Date().toISOString(),
        });
      }
    }
  } finally {
    endJob(studioId, signal);
  }
}

export const VIDEO_EXT_RE = /\.(mp4|mov|mkv|webm|m4v|avi|ts|flv|wmv|mpg|mpeg|3gp)$/i;

/** Stream an uploaded File to disk (no full in-memory buffer — multi-GB safe). */
export async function saveUpload(file: File): Promise<{ absPath: string; title: string }> {
  const id = randomUUID();
  const ext = (path.extname(file.name) || ".mp4").toLowerCase();
  const abs = path.join(mediaRoot(), `${id}${ext}`);
  const { Readable } = await import("node:stream");
  const { pipeline } = await import("node:stream/promises");
  try {
    await pipeline(
      Readable.fromWeb(file.stream() as unknown as import("node:stream/web").ReadableStream),
      fs.createWriteStream(abs),
    );
  } catch (e) {
    fs.rmSync(abs, { force: true });
    throw e;
  }
  return { absPath: abs, title: path.parse(file.name).name };
}

/**
 * Validate a video file already on this machine (e.g. downloaded by the user).
 * Used in place — no copy. Returns an error message or the resolved path/title.
 */
export function resolveLocalVideo(
  input: string,
): { ok: true; absPath: string; title: string } | { ok: false; message: string } {
  let p = input.trim().replace(/^file:\/\//, "");
  if (p.startsWith("~/")) p = path.join(process.env.HOME || "", p.slice(2));
  if (!path.isAbsolute(p)) return { ok: false, message: "Path harus absolut, mis. /home/han/Videos/video.mp4" };
  p = path.resolve(p);
  if (!VIDEO_EXT_RE.test(p)) return { ok: false, message: "Bukan file video (mp4/mov/mkv/webm/…)" };
  let st: fs.Stats;
  try {
    st = fs.statSync(p);
  } catch {
    return { ok: false, message: `File tidak ditemukan: ${p}` };
  }
  if (!st.isFile()) return { ok: false, message: "Path bukan file" };
  if (st.size < 1024) return { ok: false, message: "File kosong/rusak" };
  try {
    fs.accessSync(p, fs.constants.R_OK);
  } catch {
    return { ok: false, message: "File tidak bisa dibaca (permission)" };
  }
  return { ok: true, absPath: p, title: path.parse(p).name };
}

export { detectSource };
