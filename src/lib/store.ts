import fs from "node:fs";
import path from "node:path";
import { DEFAULT_SKILLS, type SkillPacks, type Studio } from "./types";

const ROOT = path.join(process.cwd(), "data");
const STUDIOS_DIR = path.join(ROOT, "studios");
const MEDIA_DIR = path.join(ROOT, "media");
const INDEX_PATH = path.join(ROOT, "index.json");

function ensureDirs() {
  fs.mkdirSync(STUDIOS_DIR, { recursive: true });
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  if (!fs.existsSync(INDEX_PATH)) {
    fs.writeFileSync(INDEX_PATH, JSON.stringify({ studioIds: [] }, null, 2));
  }
}

function readIndex(): { studioIds: string[] } {
  ensureDirs();
  return JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
}

function writeIndex(index: { studioIds: string[] }) {
  ensureDirs();
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
}

export function studioDir(id: string) {
  return path.join(STUDIOS_DIR, id);
}

export function mediaRoot() {
  ensureDirs();
  return MEDIA_DIR;
}

export function loadStudio(id: string): Studio | null {
  const file = path.join(studioDir(id), "studio.json");
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as Studio;
}

export function saveStudio(studio: Studio) {
  ensureDirs();
  const dir = studioDir(studio.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "clips"), { recursive: true });
  fs.writeFileSync(path.join(dir, "studio.json"), JSON.stringify(studio, null, 2));
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
  const rel = path.relative(process.cwd(), absPath).split(path.sep).join("/");
  return `/api/files?path=${encodeURIComponent(rel)}`;
}
