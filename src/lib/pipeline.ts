import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
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

function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
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

async function downloadUrl(link: string, outDir: string): Promise<{ mediaPath: string; title: string }> {
  fs.mkdirSync(outDir, { recursive: true });
  const template = path.join(outDir, "source.%(ext)s");
  await run("yt-dlp", [
    "-f",
    "bv*[height<=1080]+ba/b[height<=1080]/b",
    "--merge-output-format",
    "mp4",
    "-o",
    template,
    "--no-playlist",
    "--write-info-json",
    link,
  ]);
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

async function transcribe(audioPath: string, language: SkillPacks["captionLanguage"]): Promise<{
  language: string;
  duration: number;
  segments: TranscriptSegment[];
}> {
  const py =
    process.env.PERSONAL_CLIPPER_PYTHON ||
    path.join(process.env.HOME || "", ".hermes/cache/scratch/personal-clipper-venv/bin/python");
  const script = path.join(process.cwd(), "scripts", "transcribe.py");
  const { stdout } = await run(py, [script, audioPath, "--language", language, "--model", "base"]);
  return JSON.parse(stdout);
}

/** Score windows by speech density + punctuation excitement. Deterministic, no cloud. */
export function proposeClips(
  segments: TranscriptSegment[],
  durationSec: number,
  opts: { targetSec?: number; maxClips?: number } = {},
): ClipCandidate[] {
  const target = opts.targetSec ?? 45;
  const maxClips = opts.maxClips ?? 8;
  if (!segments.length || durationSec <= 0) {
    // fallback: evenly spaced windows
    const clips: ClipCandidate[] = [];
    const step = Math.max(target, durationSec / Math.max(1, maxClips));
    for (let i = 0; i < maxClips && i * step < durationSec; i++) {
      const start = Math.min(durationSec - 5, i * step);
      const end = Math.min(durationSec, start + target);
      if (end - start < 8) continue;
      clips.push({
        id: randomUUID(),
        start: Number(start.toFixed(2)),
        end: Number(end.toFixed(2)),
        score: 0.2,
        title: `Clip ${i + 1}`,
        reason: "fallback window",
      });
    }
    return clips;
  }

  const windows: ClipCandidate[] = [];
  for (let i = 0; i < segments.length; i++) {
    const start = segments[i].start;
    let end = start;
    let text = "";
    let j = i;
    while (j < segments.length && segments[j].end - start <= target + 10) {
      end = segments[j].end;
      text += (text ? " " : "") + segments[j].text;
      j++;
      if (end - start >= target) break;
    }
    if (end - start < 12) continue;
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const dens = words / Math.max(1, end - start);
    const bang = (text.match(/[!?]|viral|tips|cara|rahasia|penting/gi) || []).length;
    const score = dens * 0.7 + bang * 0.4 + Math.min(1, words / 40) * 0.3;
    const title = text.trim().slice(0, 72) || `Clip ${windows.length + 1}`;
    windows.push({
      id: randomUUID(),
      start: Number(start.toFixed(2)),
      end: Number(Math.min(durationSec, end).toFixed(2)),
      score: Number(score.toFixed(3)),
      title,
      reason: `speech dens=${dens.toFixed(2)} cues=${bang}`,
    });
  }

  windows.sort((a, b) => b.score - a.score);
  const picked: ClipCandidate[] = [];
  for (const w of windows) {
    if (picked.length >= maxClips) break;
    const overlap = picked.some(
      (p) => Math.min(p.end, w.end) - Math.max(p.start, w.start) > (w.end - w.start) * 0.45,
    );
    if (!overlap) picked.push(w);
  }
  return picked.sort((a, b) => a.start - b.start);
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
    // Center crop to target aspect, then scale.
    vfParts.push(
      `scale=${w}:${h}:force_original_aspect_ratio=increase`,
      `crop=${w}:${h}`,
    );
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
      bump({ status: "downloading" });
      if (current.source === "upload") {
        if (!current.sourceUrl) throw new Error("upload path missing");
        // sourceUrl for upload stores absolute path under media/
        current = bump({ mediaPath: current.sourceUrl });
      } else {
        if (!current.sourceUrl) throw new Error("link missing");
        const dl = await downloadUrl(current.sourceUrl, work);
        current = bump({
          mediaPath: dl.mediaPath,
          title: current.title === "Untitled" || !current.title ? dl.title : current.title,
        });
      }
    }

    const durationSec = await probeDuration(current.mediaPath!);
    current = bump({ durationSec });

    const audioPath = path.join(studioDir(studioId), "audio.wav");
    bump({ status: "transcribing" });
    await extractAudio(current.mediaPath!, audioPath);
    const tr = await transcribe(audioPath, current.skills.captionLanguage);
    current = bump({
      audioPath,
      transcript: tr.segments,
      durationSec: tr.duration || durationSec,
    });

    bump({ status: "clipping" });
    const candidates = proposeClips(current.transcript || [], current.durationSec || durationSec);
    current = bump({
      clips: candidates.map((c) => ({ ...c, status: "pending" as const })),
      status: "rendering",
    });

    const rendered: RenderedClip[] = [];
    for (const c of candidates) {
      try {
        rendered.push(await renderClip(current, c, current.skills, current.exportAspect));
      } catch (e) {
        rendered.push({
          ...c,
          status: "error",
          error: e instanceof Error ? e.message : String(e),
        });
      }
      bump({ clips: [...rendered, ...candidates.slice(rendered.length).map((x) => ({ ...x, status: "pending" as const }))] });
    }

    bump({ clips: rendered, status: "ready" });
  } catch (e) {
    bump({ status: "error", error: e instanceof Error ? e.message : String(e) });
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
