import fs from "node:fs";
import path from "node:path";
import { hasActiveJob, isBusyStatus } from "./jobs";
import { DEFAULT_SKILLS, type SkillPacks, type Studio } from "./types";

function rootDir() {
  return process.env.PERSONAL_CLIPPER_DATA_DIR || path.join(process.cwd(), "data");
}

export function dataRoot() {
  ensureDirs();
  return rootDir();
}
function studiosDir() {
  return path.join(rootDir(), "studios");
}
function mediaDir() {
  return path.join(rootDir(), "media");
}
function indexPath() {
  return path.join(rootDir(), "index.json");
}

function ensureDirs() {
  fs.mkdirSync(studiosDir(), { recursive: true });
  fs.mkdirSync(mediaDir(), { recursive: true });
  if (!fs.existsSync(indexPath())) {
    fs.writeFileSync(indexPath(), JSON.stringify({ studioIds: [] }, null, 2));
  }
}

function readIndex(): { studioIds: string[] } {
  ensureDirs();
  return JSON.parse(fs.readFileSync(indexPath(), "utf8"));
}

function writeIndex(index: { studioIds: string[] }) {
  ensureDirs();
  fs.writeFileSync(indexPath(), JSON.stringify(index, null, 2));
}

export function studioDir(id: string) {
  return path.join(studiosDir(), id);
}

export function mediaRoot() {
  ensureDirs();
  return mediaDir();
}

/** Raw read without stale reconciliation — for the pipeline itself. */
export function loadStudioRaw(id: string): Studio | null {
  const file = path.join(studioDir(id), "studio.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Studio;
  } catch {
    return null; // half-written file (process killed mid-write)
  }
}

export const INTERRUPTED_MESSAGE =
  "Proses terputus (server restart / mesin mati). Klik Reprocess atau Re-render untuk lanjut.";

/**
 * A studio marked busy while this server process has no job for it can never
 * finish (server restarted, machine slept, process crashed) → mark it as error
 * so the UI shows a retry instead of an eternal spinner.
 * Safe: jobs register synchronously when started, before any await.
 */
export function reconcileStale(studio: Studio): Studio {
  if (!isBusyStatus(studio.status) || hasActiveJob(studio.id)) return studio;
  const next: Studio = {
    ...studio,
    status: "error",
    error: INTERRUPTED_MESSAGE,
    progress: { pct: studio.progress?.pct ?? 0, message: "Terputus" },
    updatedAt: new Date().toISOString(),
  };
  saveStudio(next);
  return next;
}

export function loadStudio(id: string): Studio | null {
  const s = loadStudioRaw(id);
  if (!s) return null;
  return refreshMediaUrls(reconcileStale(s));
}

export function saveStudio(studio: Studio) {
  ensureDirs();
  const dir = studioDir(studio.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "clips"), { recursive: true });
  // Atomic write: a crash mid-write must not leave a corrupt studio.json.
  const file = path.join(dir, "studio.json");
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(studio, null, 2));
  fs.renameSync(tmp, file);
  const index = readIndex();
  if (!index.studioIds.includes(studio.id)) {
    index.studioIds.unshift(studio.id);
    writeIndex(index);
  }
}

export function listStudios(): Studio[] {
  const index = readIndex();
  return index.studioIds
    .map((id) => loadStudio(id))
    .filter((s): s is Studio => !!s)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function mergeSkills(partial?: Partial<SkillPacks>): SkillPacks {
  return { ...DEFAULT_SKILLS, ...partial };
}

export function publicMediaUrl(absPath: string): string {
  const rel = path.relative(rootDir(), path.resolve(absPath)).split(path.sep).join("/");
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`media outside data dir: ${absPath}`);
  }
  return `/api/files?path=${encodeURIComponent(`data/${rel}`)}`;
}

/** Map `/api/files?path=` to a real file. `data/` is dataRoot(), not process.cwd(). */
export function resolvePublicFile(rel: string): string | null {
  const decoded = rel.replaceAll("\\", "/");
  if (!decoded || decoded.includes("\0") || path.isAbsolute(decoded)) return null;
  const parts = decoded.split("/").filter(Boolean);
  if (parts.some((p) => p === ".." || p === ".")) return null;
  if (parts[0] === "data") {
    const abs = path.resolve(/* turbopackIgnore: true */ rootDir(), ...parts.slice(1));
    const root = path.resolve(/* turbopackIgnore: true */ rootDir());
    if (abs !== root && !abs.startsWith(root + path.sep)) return null;
    return abs;
  }
  if (parts[0] === "public") {
    const pub = path.resolve(/* turbopackIgnore: true */ process.cwd(), "public");
    const abs = path.resolve(/* turbopackIgnore: true */ process.cwd(), ...parts);
    if (abs !== pub && !abs.startsWith(pub + path.sep)) return null;
    return abs;
  }
  return null;
}

function refreshMediaUrls(studio: Studio): Studio {
  if (!studio.clips?.length) return studio;
  const clips = studio.clips.map((clip) => {
    const dir = path.join(studioDir(studio.id), "clips", clip.id);
    const coverFile = path.join(dir, "cover.jpg");
    const mp4 = path.join(dir, "9x16.mp4");
    let next = clip;
    if (fs.existsSync(coverFile)) {
      const url = publicMediaUrl(coverFile);
      if (clip.coverPath !== url) next = { ...next, coverPath: url };
    }
    if (fs.existsSync(mp4)) {
      const url = publicMediaUrl(mp4);
      if (clip.previewPath !== url || clip.exportPaths?.["9:16"] !== url) {
        next = { ...next, previewPath: url, exportPaths: { ...clip.exportPaths, "9:16": url } };
      }
    }
    return next;
  });
  if (clips.every((c, i) => c === studio.clips[i])) return studio;
  const next = { ...studio, clips };
  saveStudio(next);
  return next;
}
