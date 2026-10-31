/**
 * Turns raw OpenAI-compatible model ids (e.g. "9Stud/ag/claude-opus-4-6-thinking")
 * into something a human can scan: family, readable name, route badge, tags.
 * Pure + shared by the Settings UI and tests.
 */

export type RawModel = { id: string; owned_by?: string };

export type ModelFamily =
  | "Claude"
  | "GPT"
  | "Gemini"
  | "Grok"
  | "DeepSeek"
  | "Qwen"
  | "Kimi"
  | "GLM"
  | "MiniMax"
  | "MiMo"
  | "Gemma"
  | "NVIDIA"
  | "Combo"
  | "Lainnya";

export const FAMILY_ORDER: ModelFamily[] = [
  "Claude",
  "GPT",
  "Gemini",
  "Grok",
  "DeepSeek",
  "Qwen",
  "Kimi",
  "GLM",
  "MiniMax",
  "MiMo",
  "Gemma",
  "NVIDIA",
  "Combo",
  "Lainnya",
];

export type ModelTag =
  | "thinking"
  | "high"
  | "medium"
  | "low"
  | "free"
  | "1M"
  | "review"
  | "preview"
  | "mod"
  | "cepat";

export type ModelInfo = {
  id: string;
  name: string;
  family: ModelFamily;
  /** Route/provider code shown as badge, e.g. "ag", "cx", "vikey", "combo". */
  provider: string;
  /** Meta-router prefix (e.g. "9Stud") when the id is proxied through another router. */
  via?: string;
  tags: ModelTag[];
  version: number;
  /** false for image / speech models that can't rank clips. */
  chat: boolean;
};

const META_ROUTERS = new Set(["9stud"]);
const TAG_TOKENS: Record<string, ModelTag> = {
  thinking: "thinking",
  high: "high",
  medium: "medium",
  low: "low",
  free: "free",
  review: "review",
  preview: "preview",
  mod: "mod",
};
const FAST_RE = /\b(flash|flashx|lightning|haiku|mini|nano|highspeed|fast)\b/;
const NON_CHAT_RE = /(gpt-image|parakeet|-asr\b|image\.?$|redigma)/i;

const WORDS: Record<string, string> = {
  gpt: "GPT",
  glm: "GLM",
  oss: "OSS",
  deepseek: "DeepSeek",
  minimax: "MiniMax",
  mimo: "MiMo",
  ai: "AI",
  it: "IT",
  vl: "VL",
  ctc: "CTC",
  hy3: "HY3",
  hy4: "HY4",
};

/** Lower = preferred when the same model is reachable through several routes. */
export const ROUTE_PRIORITY = [
  "ag",
  "cx",
  "gcli",
  "oc",
  "openrouter",
  "nvidia",
  "alims-intl",
  "dattio",
  "vikey",
  "apmix",
  "mmf",
  "cc",
];

function familyOf(base: string, route: string[], ownedBy?: string): ModelFamily {
  const s = `${route.join("/")}/${base}`.toLowerCase();
  if (/claude|anthropic|opus|sonnet|haiku|fable/.test(s)) return "Claude";
  if (/gemini/.test(s)) return "Gemini";
  if (/gemma/.test(s)) return "Gemma";
  if (/\bgpt|codex|openai/.test(s)) return "GPT";
  if (/grok/.test(s)) return "Grok";
  if (/deepseek/.test(s)) return "DeepSeek";
  if (/qwen/.test(s)) return "Qwen";
  if (/kimi|moonshot/.test(s)) return "Kimi";
  if (/glm|z-ai|zai/.test(s)) return "GLM";
  if (/minimax/.test(s)) return "MiniMax";
  if (/mimo/.test(s)) return "MiMo";
  if (/nemotron|parakeet/.test(s)) return "NVIDIA";
  if (ownedBy === "combo" || route.length === 0) return "Combo";
  return "Lainnya";
}

function prettyToken(t: string): string {
  const low = t.toLowerCase();
  if (WORDS[low]) return WORDS[low];
  if (/^\d+b$/i.test(t) || /^a\d+b$/i.test(t)) return t.toUpperCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function prettifyModelName(base: string): { name: string; tags: ModelTag[] } {
  const tags = new Set<ModelTag>();
  let s = base;
  if (/\[1m\]/i.test(s)) {
    tags.add("1M");
    s = s.replace(/\[1m\]/gi, "");
  }
  if (/:free$/i.test(s)) {
    tags.add("free");
    s = s.replace(/:free$/i, "");
  }
  const raw = s.split(/[-_\s]+/).filter(Boolean);
  const kept: string[] = [];
  for (const tok of raw) {
    const low = tok.toLowerCase();
    if (TAG_TOKENS[low]) {
      tags.add(TAG_TOKENS[low]);
      continue;
    }
    if (/^\d{8}$/.test(tok)) continue; // dated snapshot
    kept.push(tok);
  }
  // "4","6" -> "4.6" (claude-opus-4-6 style versions)
  const merged: string[] = [];
  for (const tok of kept) {
    const prev = merged[merged.length - 1];
    if (prev && /^\d+$/.test(tok) && /^\d+$/.test(prev) && tok.length <= 2) {
      merged[merged.length - 1] = `${prev}.${tok}`;
    } else merged.push(tok);
  }
  const words = merged.map(prettyToken);
  // "GPT 6" -> "GPT-6"
  const out: string[] = [];
  for (const w of words) {
    const prev = out[out.length - 1];
    if (prev === "GPT" && /^\d/.test(w)) out[out.length - 1] = `GPT-${w}`;
    else out.push(w);
  }
  if (FAST_RE.test(base.toLowerCase())) tags.add("cepat");
  return { name: out.join(" ") || base, tags: [...tags] };
}

function versionOf(name: string): number {
  const m = name.match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 0;
}

export function parseModel(m: RawModel): ModelInfo {
  const parts = m.id.split("/").filter(Boolean);
  const base = parts[parts.length - 1] || m.id;
  let route = parts.slice(0, -1);
  let via: string | undefined;
  if (route.length && META_ROUTERS.has(route[0].toLowerCase())) {
    via = route[0];
    route = route.slice(1);
  }
  const ownedBy = m.owned_by && !META_ROUTERS.has(m.owned_by.toLowerCase()) ? m.owned_by : undefined;
  const provider = route[0] || (ownedBy === "combo" || !ownedBy ? "combo" : ownedBy);
  const { name, tags } = prettifyModelName(base);
  const family = familyOf(base, route, m.owned_by);
  const display = family === "Combo" ? `${name} (combo)` : name;
  return {
    id: m.id,
    name: display,
    family,
    provider,
    via,
    tags,
    version: versionOf(name),
    chat: !NON_CHAT_RE.test(m.id),
  };
}

export function routeRank(info: ModelInfo): number {
  const i = ROUTE_PRIORITY.indexOf(info.provider);
  return (i < 0 ? ROUTE_PRIORITY.length : i) + (info.via ? 50 : 0);
}

export function sortModels(list: ModelInfo[]): ModelInfo[] {
  return [...list].sort(
    (a, b) =>
      FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family) ||
      b.version - a.version ||
      a.name.localeCompare(b.name) ||
      routeRank(a) - routeRank(b) ||
      a.id.localeCompare(b.id),
  );
}

/** Same model reachable directly and via a meta-router: keep only the direct one. */
export function hideViaDuplicates(list: ModelInfo[]): ModelInfo[] {
  const direct = new Set(list.filter((m) => !m.via).map((m) => m.id));
  return list.filter((m) => !m.via || !direct.has(m.id.split("/").slice(1).join("/")));
}

function subsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (const ch of hay) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return needle.length === 0;
}

/** Token-wise fuzzy score; 0 = no match. */
export function fuzzyScore(query: string, m: ModelInfo): number {
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  const name = m.name.toLowerCase();
  const hay = `${name} ${m.family} ${m.provider} ${m.via || ""} ${m.tags.join(" ")} ${m.id}`.toLowerCase();
  let score = 0;
  for (const tok of q.split(/\s+/)) {
    const nIdx = name.indexOf(tok);
    if (nIdx === 0) score += 120;
    else if (nIdx > 0) score += 90 - Math.min(40, nIdx);
    else if (hay.includes(tok)) score += 60;
    else if (subsequence(tok, name.replace(/\s+/g, ""))) score += 25;
    else if (subsequence(tok, m.id.toLowerCase())) score += 10;
    else return 0;
  }
  return score;
}

export type Recommendation = {
  key: "smart" | "balanced" | "fast" | "cheap";
  label: string;
  hint: string;
  model: ModelInfo;
};

const REC_SLOTS: Array<Omit<Recommendation, "model"> & { match: (m: ModelInfo) => boolean }> = [
  {
    key: "smart",
    label: "Akurat",
    hint: "Ranking dan judul, lebih lambat",
    match: (m) => m.family === "Claude" && /opus/i.test(m.name),
  },
  {
    key: "balanced",
    label: "Seimbang",
    hint: "Lebih cepat dari Opus",
    match: (m) => m.family === "Claude" && /sonnet/i.test(m.name),
  },
  {
    key: "fast",
    label: "Cepat",
    hint: "Respon dalam hitungan detik",
    match: (m) =>
      m.family === "GPT" && !/codex|reserve|daybreak|oss|image|review/i.test(m.id) && !m.tags.includes("1M"),
  },
  {
    key: "cheap",
    label: "Hemat",
    hint: "Murah/ringan, cocok buat draft",
    match: (m) => (m.family === "Gemini" || m.family === "DeepSeek") && m.tags.includes("cepat"),
  },
];

function tierPenalty(m: ModelInfo): number {
  let p = 0;
  if (m.tags.includes("thinking")) p += 3;
  if (m.tags.includes("low")) p += 2;
  if (m.tags.includes("high")) p += 1;
  if (m.tags.includes("mod") || m.tags.includes("review") || m.tags.includes("preview")) p += 4;
  return p;
}

export function recommendModels(list: ModelInfo[]): Recommendation[] {
  const used = new Set<string>();
  const out: Recommendation[] = [];
  for (const slot of REC_SLOTS) {
    const pool = list.filter((m) => m.chat && !used.has(m.id) && slot.match(m));
    if (!pool.length) continue;
    pool.sort(
      (a, b) =>
        b.version - a.version || tierPenalty(a) - tierPenalty(b) || routeRank(a) - routeRank(b) || a.id.length - b.id.length,
    );
    const { match: _match, ...meta } = slot;
    void _match;
    out.push({ ...meta, model: pool[0] });
    used.add(pool[0].id);
  }
  return out;
}
