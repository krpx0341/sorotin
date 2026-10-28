import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { proposeClips, type SceneCut, type SilenceGap } from "./clipper";
import type {
  AspectRatio,
  ClipCandidate,
  RenderedClip,
  SkillPacks,
  SourceKind,
  Studio,
  TranscriptSegment,
} from "./types";
import { loadStudio, mediaRoot, publicMediaUrl, saveStudio, studioDir } from "./store";

export { proposeClips } from "./clipper";

function run(
  cmd: string,
  args: string[],
  opts: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    onStderr?: (chunk: string) => void;
    onStdout?: (chunk: string) => void;
  } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      const s = d.toString();
      stdout += s;
      opts.onStdout?.(s);
    });
    child.stderr.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      opts.onStderr?.(s);
    });
    child.on("error", reject);
    child.on("close", (code) => {
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

async function downloadUrl(
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
      "--write-info-json",
      "--no-write-comments",
      "--no-write-thumbnail",
      link,
    ],
    {
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
  const py =
    process.env.PERSONAL_CLIPPER_PYTHON ||
    path.join(process.env.HOME || "", ".hermes/cache/scratch/personal-clipper-venv/bin/python");
  const script = path.join(process.cwd(), "scripts", "transcribe.py");
  const model = process.env.PERSONAL_CLIPPER_WHISPER_MODEL || "base";
  const { stdout } = await run(py, [script, audioPath, "--language", language, "--model", model]);
  return JSON.parse(stdout);
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

  const vfParts: string[] = [];
  if (skills.autoReframe) {
    vfParts.push(`scale=${w}:${h}:force_original_aspect_ratio=increase`, `crop=${w}:${h}`);
  } else {
    vfParts.push(
      `scale=${w}:${h}:force_original_aspect_ratio=decrease`,
      `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`,
    );
  }

  if (skills.smartHook) {
    const hook = escapeDrawtext(clip.title.slice(0, 48));
    const style =
      skills.hookStyle === "dark"
        ? "fontcolor=white:box=1:boxcolor=black@0.75"
        : skills.hookStyle === "bold"
          ? "fontcolor=yellow:box=1:boxcolor=red@0.7"
          : skills.hookStyle === "sticker"
            ? "fontcolor=black:box=1:boxcolor=white@0.9"
            : skills.hookStyle === "clapper"
              ? "fontcolor=white:box=1:boxcolor=black@0.85"
              : "fontcolor=white:box=1:boxcolor=black@0.55";
    vfParts.push(
      `drawtext=text='${hook}':fontsize=48:x=(w-text_w)/2:y=h*0.12:${style}:boxborderw=18`,
    );
  }

  if (skills.captions && studio.transcript?.length) {
    const lines = studio.transcript
      .filter((s) => s.end >= clip.start && s.start <= clip.end)
      .slice(0, 3)
      .map((s) => s.text)
      .join(" ")
      .slice(0, 90);
    if (lines) {
      vfParts.push(
        `drawtext=text='${escapeDrawtext(lines)}':fontsize=36:x=(w-text_w)/2:y=h*0.78:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=14`,
      );
    }
  }

  const vf = vfParts.join(",");
  // Input seeking first — much faster than decode-then-seek for long sources.
  await run("ffmpeg", [
    "-y",
    "-ss",
    String(clip.start),
    "-to",
    String(clip.end),
    "-i",
    studio.mediaPath,
    "-vf",
    vf,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    outPath,
  ]);

  if (skills.smartCover) {
    await run("ffmpeg", [
      "-y",
      "-ss",
      String(clip.start + Math.min(2, (clip.end - clip.start) / 3)),
      "-i",
      studio.mediaPath,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      coverPath,
    ]);
  }

  return {
    ...clip,
    status: "ready",
    previewPath: publicMediaUrl(outPath),
    exportPaths: { [aspect]: publicMediaUrl(outPath) },
    coverPath: skills.smartCover ? publicMediaUrl(coverPath) : undefined,
  };
}

export async function processStudio(studioId: string) {
  const studio = loadStudio(studioId);
  if (!studio) throw new Error("studio not found");

  const bump = (patch: Partial<Studio>) => {
    const next = { ...loadStudio(studioId)!, ...patch, updatedAt: new Date().toISOString() };
    saveStudio(next);
    return next;
  };

  try {
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
    bump({ progress: { pct: 48, message: "Whisper transcribe…" } });
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
    const candidates = proposeClips(current.transcript || [], current.durationSec || durationSec, {
      targetSec: Number(process.env.PERSONAL_CLIPPER_TARGET_SEC || 40),
      maxClips: Number(process.env.PERSONAL_CLIPPER_MAX_CLIPS || 8),
      silences,
      scenes,
    });
    current = bump({
      clips: candidates.map((c) => ({ ...c, status: "pending" as const })),
      status: "rendering",
      progress: { pct: 72, message: `Render ${candidates.length} clip…` },
    });

    const rendered: RenderedClip[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      try {
        rendered.push(await renderClip(current, c, current.skills, current.exportAspect));
      } catch (e) {
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
  } catch (e) {
    bump({
      status: "error",
      error: e instanceof Error ? e.message : String(e),
      progress: { pct: 100, message: "Gagal" },
    });
  }
}

export async function saveUpload(file: File): Promise<{ absPath: string; title: string }> {
  const buf = Buffer.from(await file.arrayBuffer());
  const id = randomUUID();
  const ext = path.extname(file.name) || ".mp4";
  const abs = path.join(mediaRoot(), `${id}${ext}`);
  fs.writeFileSync(abs, buf);
  return { absPath: abs, title: path.parse(file.name).name };
}

export { detectSource };
