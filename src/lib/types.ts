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

export type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
};

export type ClipCandidate = {
  id: string;
  start: number;
  end: number;
  score: number;
  title: string;
  reason: string;
};

export type RenderedClip = ClipCandidate & {
  status: "pending" | "ready" | "error";
  previewPath?: string;
  exportPaths?: Partial<Record<AspectRatio, string>>;
  coverPath?: string;
  error?: string;
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
  skills: SkillPacks;
  mediaPath?: string;
  audioPath?: string;
  durationSec?: number;
  transcript?: TranscriptSegment[];
  clips: RenderedClip[];
  exportAspect: AspectRatio;
};

export type CreateStudioInput = {
  source: SourceKind;
  link?: string;
  title?: string;
  skills?: Partial<SkillPacks>;
  exportAspect?: AspectRatio;
};

export const DEFAULT_SKILLS: SkillPacks = {
  smartCover: true,
  smartHook: true,
  hookStyle: "classic",
  autoReframe: true,
  captions: true,
  captionLanguage: "id",
};
