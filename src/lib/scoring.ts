/**
 * Clip hook lines + honest virality scoring.
 *
 * Old local score (pre v8): keyword *counts* (hook words incl. very common ones like
 * "cara", "karena", "?"), clamped at 1.0, then +0.08/+0.06 boosts near scene cuts /
 * silences, shown as round(score*99). Any long chatty window saturated hook=1 and
 * value=1, so every clip landed at 95–99 — the number carried no information.
 *
 * Now: four parts (hook, emotion, payoff, clarity, each 0–10) from rates (per 30s),
 * not counts, with explicit reasons. Local results are labelled "estimasi lokal";
 * AI results come from the model with its own reasons.
 */
import type { ClipScoring, TranscriptSegment, ViralityGrades } from "./types";

const norm = (t: string) => t.replace(/\s+/g, " ").trim();
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export const SCORE_WEIGHTS = { hook: 0.35, emotion: 0.2, payoff: 0.25, clarity: 0.2 } as const;

export function combineParts(p: ClipScoring["parts"]): number {
  const raw =
    p.hook * SCORE_WEIGHTS.hook +
    p.emotion * SCORE_WEIGHTS.emotion +
    p.payoff * SCORE_WEIGHTS.payoff +
    p.clarity * SCORE_WEIGHTS.clarity;
  return Math.round(clamp(raw * 10, 0, 100));
}

/** Back-compat grades (0..1) for older UI bits: hook, flow≈clarity, value≈payoff, trend≈emotion. */
export function gradesFromParts(p: ClipScoring["parts"]): ViralityGrades {
  const f = (n: number) => Number(clamp(n / 10, 0, 1).toFixed(2));
  return { hook: f(p.hook), flow: f(p.clarity), value: f(p.payoff), trend: f(p.emotion) };
}

const QUESTION = /\?|\b(kenapa|mengapa|gimana|bagaimana|apakah|siapa|kok|berapa|why|how|what|who)\b/i;
const HOOKY =
  /\b(ternyata|rahasia|jangan|bongkar|fakta|pertama kali|gak nyangka|nggak nyangka|tiba-tiba|akhirnya|sumpah|serius|parah|gila|anjir|wajib|stop|never|secret|mistake|nobody|truth)\b/gi;
const EMOTION =
  /\b(nangis|menangis|sedih|marah|takut|kaget|sakit|cinta|sayang|bahagia|senang|malu|kecewa|trauma|curhat|hancur|kangen|rindu|benci|stres|depresi|bangga|bersyukur|patah hati|cemburu|selingkuh|mantan|cerai|meninggal|kehilangan|ditinggal|dikhianati|love|hate|cry|afraid|angry|heartbroken|scared)\b/gi;
const INTENSE = /\b(banget|parah|sumpah|beneran|serius|gila|anjir|bgt|sangat|literally|really)\b|!/gi;
const LAUGH = /\b(haha\w*|wkwk\w*|hehe\w*|lol)\b/gi;
const VALUE =
  /\b(tips|cara|langkah|solusi|pelajaran|belajar|intinya|kuncinya|ternyata|hasilnya|makanya|jadi intinya|the point|lesson|how to)\b/gi;
const CONNECTOR_START =
  /^(dan|atau|tapi|terus|trus|jadi|karena|karna|yang|dengan|untuk|sama|kayak|akhirnya|soalnya|makanya|nah|and|or|but|so|because|then|which)\b/i;
const PRONOUN_START = /^(dia|itu|ini|tadi|mereka|begitu|gitu|he|she|they|it|that|this)\b/i;
const CONNECTOR_END =
  /\b(dan|atau|tapi|terus|jadi|karena|kalau|kalo|yang|dengan|untuk|buat|di|ke|dari|sama|kayak|cara|si|itu|ini|and|or|but|so|the|a|to|of|with|for|that)$/i;
const FILLER = /\b(eh|em|emm|hmm|anu|apa namanya|gitu loh|kayak gitu|um|uh|like)\b/gi;
const EDGE_FILLER = /^(oke|ok|ya|yah|nah|eh|em|hmm|jadi|terus|gitu|sih|kan|so|um|uh|okay|yeah|well)\b[\s,]*/i;
const TAIL_FILLER = /[\s,]*\b(oke|ok|ya|yah|nah|gitu|sih|loh|kan|deh|dong|okay|yeah|right)$/i;

// Words that carry no topic on their own (title mode rewards sentences with substance).
const VAGUE = new Set(
  "kayaknya kayak lumayan gitu begitu banget juga sudah udah lagi masih sama yang kalau kalo tapi terus jadi karena soalnya memang emang pokoknya sebenarnya beneran mungkin orang sesuatu something thing things really just like kind maybe about".split(" "),
);
const substance = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !VAGUE.has(w)).length;

const count = (re: RegExp, t: string) => (t.match(re) || []).length;
const uniq = (re: RegExp, t: string) => [...new Set((t.match(re) || []).map((x) => x.toLowerCase()))];

export function clipText(segments: TranscriptSegment[], start: number, end: number): string {
  return norm(
    segments
      .filter((s) => s.end > start + 0.2 && s.start < end - 0.2)
      .map((s) => s.text)
      .join(" "),
  );
}

/** Local, labelled estimate. Deliberately conservative: typical clips land ~35–65. */
export function localScoring(segments: TranscriptSegment[], start: number, end: number): ClipScoring {
  const dur = Math.max(1, end - start);
  const text = clipText(segments, start, end);
  const opening = clipText(segments, start, Math.min(end, start + 6));
  const words = text ? text.split(" ").length : 0;
  const per30 = (n: number) => (n * 30) / dur;
  const reasons: string[] = [];

  // Hook — what happens in the first ~6s
  let hook = 2;
  if (QUESTION.test(opening)) {
    hook += 3;
    reasons.push("Buka dengan pertanyaan");
  }
  const hookyOpen = uniq(HOOKY, opening).concat(uniq(EMOTION, opening));
  if (hookyOpen.length) {
    hook += Math.min(3, hookyOpen.length * 1.5);
    reasons.push(`Kata pemancing di awal: ${hookyOpen.slice(0, 3).join(", ")}`);
  }
  if (/\d/.test(opening)) hook += 1;
  if (CONNECTOR_START.test(opening) || PRONOUN_START.test(opening)) {
    hook -= 2;
    reasons.push("Dibuka kata sambung/rujukan — butuh konteks");
  }

  // Emotion — rate, not count
  const emo = uniq(EMOTION, text);
  let emotion = 1 + Math.min(5, per30(count(EMOTION, text)) * 1.5) + Math.min(2, per30(count(INTENSE, text)) * 0.5);
  emotion += Math.min(1.5, count(LAUGH, text) * 0.75);
  if (emo.length) reasons.push(`Muatan emosi: ${emo.slice(0, 3).join(", ")}`);

  // Payoff — clean ending + takeaway density
  const tail = text.slice(-80);
  let payoff = 2;
  if (/[.!]["')\]]?$/.test(text)) {
    payoff += 3;
    reasons.push("Berakhir di kalimat utuh");
  } else if (/\?["')\]]?$/.test(text)) {
    payoff -= 1;
    reasons.push("Berakhir di pertanyaan — jawaban terpotong?");
  }
  if (CONNECTOR_END.test(tail.replace(/[.,!?…]+$/, ""))) payoff -= 2;
  payoff += Math.min(3, per30(count(VALUE, text)));
  if (dur >= 20 && dur <= 60) payoff += 1;

  // Clarity — can a stranger follow it?
  let clarity = 3;
  const wps = words / dur;
  if (wps >= 1.6 && wps <= 3.4) clarity += 3;
  else if (wps < 1) {
    clarity -= 1;
    reasons.push("Banyak jeda / sedikit bicara");
  }
  const fillerRate = words ? count(FILLER, text) / words : 0;
  if (fillerRate < 0.02) clarity += 2;
  else if (fillerRate > 0.05) {
    clarity -= 1;
    reasons.push("Banyak filler (eh/anu/kayak gitu)");
  }
  if (!CONNECTOR_START.test(text) && !PRONOUN_START.test(text)) clarity += 1;

  const parts = {
    hook: Number(clamp(hook, 0, 10).toFixed(1)),
    emotion: Number(clamp(emotion, 0, 10).toFixed(1)),
    payoff: Number(clamp(payoff, 0, 10).toFixed(1)),
    clarity: Number(clamp(clarity, 0, 10).toFixed(1)),
  };
  return { source: "local", score: combineParts(parts), parts, reasons: reasons.slice(0, 4) };
}

/* ───────────────────────── hook line ───────────────────────── */

export const HOOK_MAX_WORDS = 8;

function cleanPhrase(t: string): string {
  let s = norm(t).replace(/(\.\.\.|…)+/g, "").replace(/^[-–—,;:\s]+/, "");
  for (let k = 0; k < 3; k++) s = s.replace(EDGE_FILLER, "").replace(TAIL_FILLER, "").trim();
  return s.replace(/[,;:\s]+$/, "");
}

function capWords(t: string, max = HOOK_MAX_WORDS): string {
  const words = t.split(" ");
  if (words.length <= max) return t;
  let cut = words.slice(0, max);
  while (cut.length > 3 && CONNECTOR_END.test(cut[cut.length - 1].replace(/[.,!?]+$/, ""))) cut = cut.slice(0, -1);
  return `${cut.join(" ").replace(/[,;:]+$/, "")}…`;
}

function finish(t: string): string {
  let s = t.trim();
  if (!s) return s;
  if (QUESTION.test(s) && !/[?!.…]$/.test(s)) s = `${s}?`;
  s = s.replace(/[.]$/, "");
  return s.charAt(0).toLocaleUpperCase() + s.slice(1);
}

/** Make sure an AI-provided hook is short and whole-word. */
export function sanitizeHook(raw: string | undefined): string {
  const t = cleanPhrase(String(raw || "").replace(/^["'“”]+|["'“”]+$/g, ""));
  return t ? finish(capWords(t, HOOK_MAX_WORDS + 1)) : "";
}

/**
 * Punchy on-screen hook without an LLM: the most hook-like whole sentence/clause from the
 * clip title or its first seconds, 3–8 words, never cut mid-word.
 */
export function localHookLine(title: string, segments: TranscriptSegment[], start: number, end: number): string {
  const best = pickLine(title, segments, start, end, HOOK_MAX_WORDS, false);
  return finish(capWords(best || cleanPhrase(title) || "Simak sampai habis"));
}

export const TITLE_MAX_WORDS = 12;
export const TITLE_MAX_CHARS = 64;

/** Trim an AI-provided card title: no quotes/hashtags/emoji, whole words, ≤ TITLE_MAX_CHARS. */
export function sanitizeTitle(raw: string | undefined): string {
  let t = cleanPhrase(
    String(raw || "")
      .replace(/^["'“”]+|["'“”]+$/g, "")
      .replace(/#\S+/g, "")
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, ""),
  );
  t = t.replace(/\.+$/, "");
  if (t.length > TITLE_MAX_CHARS) {
    const cut = t.slice(0, TITLE_MAX_CHARS + 1).split(" ").slice(0, -1).join(" ");
    t = cut.replace(/[,;:\s]+$/, "") + "…";
  }
  return t ? finish(t) : "";
}

/**
 * Card title without an LLM: the most title-like *whole* sentence/clause of the clip
 * (same rules as the hook line, but up to TITLE_MAX_WORDS and never cut mid-sentence
 * when any whole sentence fits). `rawTitle` is the transcript-derived seed title.
 */
export function localTitle(rawTitle: string, segments: TranscriptSegment[], start: number, end: number): string {
  const best = pickLine(rawTitle, segments, start, end, TITLE_MAX_WORDS, true);
  const t = best || cleanPhrase(rawTitle) || "Clip tanpa judul";
  return sanitizeTitle(capWords(t, TITLE_MAX_WORDS));
}

/** Score candidate sentences/clauses from the seed title + the clip's opening. */
function pickLine(
  title: string,
  segments: TranscriptSegment[],
  start: number,
  end: number,
  maxWords: number,
  wholeOnly: boolean,
): string {
  const early = clipText(segments, start, Math.min(end, start + Math.max(10, (end - start) * 0.4)));
  const pieces: Array<{ text: string; fromTitle: boolean; pos: number }> = [];
  const split = (t: string) => t.match(/[^.?!…]+[.?!…]*/g) || [];
  split(title).forEach((p, i) => pieces.push({ text: p, fromTitle: true, pos: i }));
  split(early).forEach((p, i) => {
    pieces.push({ text: p, fromTitle: false, pos: i });
    // long sentences: also offer their comma clauses
    if (p.split(" ").length > maxWords) p.split(/,\s*/).forEach((c) => pieces.push({ text: c, fromTitle: false, pos: i + 0.5 }));
  });
  let best = "";
  let bestScore = -Infinity;
  const ideal = Math.round(maxWords * 0.7);
  const fitsLen = (t: string) => {
    const n = t.split(" ").filter(Boolean).length;
    return n >= 3 && n <= maxWords && (!wholeOnly || t.replace(/[.!?…]+$/, "").length <= TITLE_MAX_CHARS);
  };
  const fits = pieces.some((pc) => fitsLen(cleanPhrase(pc.text)));
  for (const pc of pieces) {
    const t = cleanPhrase(pc.text);
    const n = t ? t.split(" ").length : 0;
    if (n < 3) continue;
    if (wholeOnly && fits && !fitsLen(t)) continue;
    let sc = 0;
    if (QUESTION.test(t)) sc += wholeOnly ? 1 : 2;
    // a title has to say what the clip is about; vague one-liners lose
    if (wholeOnly) sc += Math.min(2.5, substance(t) * 0.5) - (substance(t) < 2 ? 1.5 : 0);
    sc += Math.min(2, count(HOOKY, t)) + Math.min(2, count(EMOTION, t));
    if (/\d/.test(t)) sc += 0.6;
    if (CONNECTOR_START.test(t)) sc -= 1.5;
    if (PRONOUN_START.test(t)) sc -= 0.8;
    if (CONNECTOR_END.test(t.replace(/[.,!?…]+$/, ""))) sc -= 1;
    sc -= Math.abs(Math.min(n, maxWords + 4) - ideal) * 0.15 + (n > maxWords ? 0.8 : 0);
    if (pc.fromTitle && !wholeOnly) sc += 0.5;
    sc -= pc.pos * 0.15;
    if (sc > bestScore) {
      bestScore = sc;
      best = t;
    }
  }
  return best;
}
