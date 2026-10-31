export type SourceKind = "youtube" | "tiktok" | "upload";

export type StudioStatus =
  | "queued"
  | "downloading"
  | "transcribing"
  | "clipping"
  | "rendering"
  | "ready"
  | "error";

export type AspectRatio = "9:16" | "16:9" | "1:1";

export type HookStyle = "classic" | "dark" | "bold" | "sticker" | "clapper";

export type SkillPacks = {
  smartCover: boolean;
  smartHook: boolean;
  hookStyle: HookStyle;
  autoReframe: boolean;
  captions: boolean;
  captionLanguage: "id" | "en" | "auto";
};

export type TranscriptWord = {
  start: number;
  end: number;
  word: string;
};

export type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
  words?: TranscriptWord[];
};

export type ViralityGrades = {
  hook: number;
  flow: number;
  value: number;
  trend: number;
};

/** Honest, explainable virality estimate (0–100) — AI-graded or a labelled local estimate. */
export type ClipScoring = {
  source: "ai" | "local";
  /** 0–100 shown to the user. */
  score: number;
  /** Each 0–10. */
  parts: { hook: number; emotion: number; payoff: number; clarity: number };
  /** Short human reasons (Indonesian / transcript language). */
  reasons: string[];
  model?: string;
};

export type ClipCandidate = {
  id: string;
  start: number;
  end: number;
  score: number;
  title: string;
  reason: string;
  grades?: ViralityGrades;
  /** Short on-screen hook line (≤ ~8 words). */
  hook?: string;
  scoring?: ClipScoring;
  /** Who wrote `title`: AI headline, cleaned local sentence, or raw (undefined). */
  titleSource?: "ai" | "local";
  /** User renamed the clip — re-render/re-score must never overwrite the title. */
  titleEdited?: boolean;
  description?: string;
  liked?: boolean | null;
  hidden?: boolean;
};

export type RenderedClip = ClipCandidate & {
  status: "pending" | "ready" | "error";
  previewPath?: string;
  exportPaths?: Partial<Record<AspectRatio, string>>;
  coverPath?: string;
  error?: string;
};

export type StudioProgress = {
  pct: number;
  message: string;
};

export type Studio = {
  id: string;
  title: string;
  source: SourceKind;
  sourceUrl?: string;
  createdAt: string;
  updatedAt: string;
  status: StudioStatus;
  error?: string;
  progress?: StudioProgress;
  skills: SkillPacks;
  mediaPath?: string;
  audioPath?: string;
  durationSec?: number;
  transcript?: TranscriptSegment[];
  clips: RenderedClip[];
  exportAspect: AspectRatio;
  targetSec?: number;
  genre?: string;
  /** How clips were picked on the last run (AI model vs local heuristic + why). */
  ranking?: { source: "ai" | "local"; model?: string; error?: string };
  /** Calm display title (AI short title, cleaned original, or a user rename). `title` stays the original. */
  displayTitle?: string;
  displayTitleSource?: "ai" | "local" | "user";
};

export type CreateStudioInput = {
  source: SourceKind;
  link?: string;
  title?: string;
  skills?: Partial<SkillPacks>;
  exportAspect?: AspectRatio;
  targetSec?: number;
  genre?: string;
};

export const DEFAULT_SKILLS: SkillPacks = {
  smartCover: true,
  smartHook: true,
  hookStyle: "classic",
  autoReframe: true,
  captions: true,
  captionLanguage: "id",
};

export const CLIP_LENGTH_PRESETS = [
  { id: "auto", label: "Auto (20–60s)", targetSec: 40 },
  { id: "short", label: "< 30s", targetSec: 25 },
  { id: "mid", label: "30–60s", targetSec: 45 },
  { id: "long", label: "60–90s", targetSec: 75 },
] as const;

export const GENRE_PRESETS = [
  { id: "podcast", label: "Podcast / Talk" },
  { id: "education", label: "Edukasi / Tips" },
  { id: "story", label: "Story / Drama" },
  { id: "entertainment", label: "Entertainment" },
  { id: "general", label: "General" },
] as const;
