import { randomUUID } from "node:crypto";
import type { ClipCandidate, TranscriptSegment, ViralityGrades } from "./types";

export type SilenceGap = { start: number; end: number };
export type SceneCut = { at: number };

const HOOK_WORDS =
  /[!?]|viral|tips|cara|rahasia|penting|jangan|ternyata|akhirnya|shock|gila|wow|must|never|secret|hack|why|how to|mistake|warning|stop|wait|listen|break|best|worst|rahasia|bongkar|fakta|hati-hati|wajib|langsung|diet|turun/gi;

const VALUE_WORDS =
  /tips|cara|langkah|alasan|karena|hasil|contoh|belajar|solusi|hack|mistake|jangan|wajib|rahasia|fakta|how to|why|because|result|learn/gi;

const TREND_WORDS =
  /viral|trend|trending|tiktok|reels|fyp|2024|2025|2026|sekarang|lagi hits|hot|challenge/gi;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/** Clips must not share content (≤1s tolerance) — duplicates feel like spam. */
export function overlaps(a: { start: number; end: number }, b: { start: number; end: number }, toleranceSec = 1) {
  const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  return overlap > toleranceSec;
}

// Words that signal an unfinished clause when a clip ends on them / starts mid-thought.
const CONNECTOR_END =
  /(?:^|\s)(dan|atau|tapi|terus|trus|jadi|karena|karna|kalau|kalo|yang|dengan|untuk|buat|di|ke|dari|sama|kayak|kaya|cara|akhirnya|soalnya|makanya|biar|supaya|tuh|itu|ini|si|and|or|but|so|because|the|a|an|to|of|with|for|if|that|my|your)$/i;
const CONNECTOR_START =
  /^(dan|atau|tapi|terus|trus|jadi|karena|karna|yang|dengan|untuk|sama|kayak|akhirnya|soalnya|makanya|cara|and|or|but|so|because|then|which)\b/i;
const FILLER_EDGE = /^(oke|ok|ya|yah|nah|eh|em|emm|hmm|gitu|sih|loh|lho|kan|jadi|terus|so|um|uh|like|okay|yeah)\b[\s,]*/i;
const FILLER_TAIL = /[\s,]*\b(oke|ok|ya|yah|nah|gitu|sih|loh|lho|kan|deh|dong|okay|yeah|right)$/i;
const QUESTION_RE = /\?|\b(kenapa|mengapa|gimana|bagaimana|apa|apakah|siapa|kapan|kok|berapa|why|how|what|who|when)\b/i;

const norm = (t: string) => t.replace(/\s+/g, " ").trim();

/** How cleanly a clip can END after segment i (punctuation / pause / no dangling connector). */
export function endQuality(segments: TranscriptSegment[], i: number): number {
  const s = segments[i];
  const next = segments[i + 1];
  const text = norm(s.text);
  const gap = next ? next.start - s.end : 2;
  let q = Math.min(1, gap / 0.8);
  // "..." / "…" from Whisper means the speaker trails off and continues.
  if (/(\.\.\.|…)["')\]]?$/.test(text)) q -= 0.6;
  else if (/[.!]["')\]]?$/.test(text)) q += 1;
  // Ending on a question usually cuts before the answer.
  if (/\?["')\]]?$/.test(text)) q -= 0.4;
  if (CONNECTOR_END.test(text.replace(/[.,!?…]+$/, ""))) q -= 0.9;
  return q;
}

/** How cleanly a clip can START at segment i (previous thought finished, no leading connector). */
export function startQuality(segments: TranscriptSegment[], i: number): number {
  const s = segments[i];
  const prev = segments[i - 1];
  const text = norm(s.text);
  const gap = prev ? s.start - prev.end : 2;
  let q = Math.min(1, gap / 0.8);
  if (prev && /[.!?…]["')\]]?$/.test(norm(prev.text))) q += 1;
  if (CONNECTOR_START.test(text)) q -= 0.7;
  if (FILLER_EDGE.test(text) && text.split(" ").length <= 2) q -= 0.3;
  return q;
}

/**
 * On-screen hook title without an LLM: pick the most hook-like phrase
 * (question / hook words / numbers, early in the clip), trim filler, sentence-case.
 */
export function hookTitleFromSegments(segs: TranscriptSegment[], fallback: string, maxChars = 52): string {
  const texts = segs.map((s) => norm(s.text)).filter(Boolean);
  if (!texts.length) return fallback;
  let best = "";
  let bestScore = -Infinity;
  for (let i = 0; i < texts.length; i++) {
    let phrase = "";
    for (let j = i; j < Math.min(texts.length, i + 4); j++) {
      phrase = norm(`${phrase} ${texts[j]}`);
      const words = phrase.split(" ").length;
      if (words < 4) continue;
      if (words > 11) break;
      let sc = 0;
      if (QUESTION_RE.test(phrase)) sc += 2;
      sc += Math.min(3, (phrase.match(HOOK_WORDS) || []).length);
      if (/\d/.test(phrase)) sc += 0.8;
      if (CONNECTOR_START.test(phrase)) sc -= 1;
      if (CONNECTOR_END.test(phrase)) sc -= 1;
      sc -= (i / texts.length) * 1.5; // the hook should come early
      sc -= Math.abs(words - 7) * 0.08;
      if (sc > bestScore) {
        bestScore = sc;
        best = phrase;
      }
    }
  }
  if (!best) best = texts.slice(0, 3).join(" ");
  // Keep whole sentences: stop after the first sentence(s) reaching ≥4 words.
  const sentences = best.match(/[^.?!…]+[.?!…]+|[^.?!…]+$/g) || [best];
  if (sentences.length > 1) {
    let acc = "";
    for (const sn of sentences) {
      acc = norm(`${acc} ${sn}`);
      if (acc.split(" ").length >= 4) break;
    }
    best = acc;
  }
  let t = best.replace(/(\.\.\.|…)+$/, "");
  for (let k = 0; k < 3; k++) t = t.replace(FILLER_EDGE, "").replace(FILLER_TAIL, "").trim();
  if (!t) t = best;
  if (t.length > maxChars) {
    const cut = t.slice(0, maxChars);
    const sp = cut.lastIndexOf(" ");
    t = (sp > 20 ? cut.slice(0, sp) : cut).replace(/[\s,]+$/, "");
    t = `${t}…`;
  } else if (QUESTION_RE.test(t) && !/[?!.…]$/.test(t)) {
    t = `${t}?`;
  }
  return t.charAt(0).toLocaleUpperCase() + t.slice(1);
}

function titleFromText(text: string, fallback: string) {
  const t = text.replace(/\s+/g, " ").trim();
  return (t.slice(0, 72) || fallback).trim();
}

function gradeText(text: string, start: number, end: number, durationSec: number): ViralityGrades {
  const dur = Math.max(1, end - start);
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const dens = words / dur;
  const hooks = (text.match(HOOK_WORDS) || []).length;
  const values = (text.match(VALUE_WORDS) || []).length;
  const trends = (text.match(TREND_WORDS) || []).length;
  const question = /\?|mengapa|kenapa|why|how/i.test(text) ? 0.2 : 0;
  const complete = /[.!?…]["']?\s*$/.test(text.trim()) || /[.!?…]/.test(text.slice(-24)) ? 0.15 : 0;
  const early = start < durationSec * 0.2 ? 0.1 : 0;

  const hook = clamp(hooks * 0.18 + question + early + (dens > 1.6 ? 0.1 : 0), 0, 1);
  const flow = clamp(Math.min(1, dens / 2.4) * 0.7 + complete + (dur >= 20 && dur <= 55 ? 0.15 : 0), 0, 1);
  const value = clamp(values * 0.2 + Math.min(0.35, words / 80) + complete * 0.5, 0, 1);
  const trend = clamp(trends * 0.25 + hooks * 0.05, 0, 1);
  return {
    hook: Number(hook.toFixed(2)),
    flow: Number(flow.toFixed(2)),
    value: Number(value.toFixed(2)),
    trend: Number(trend.toFixed(2)),
  };
}

function aggregateScore(g: ViralityGrades) {
  return Number((g.hook * 0.35 + g.flow * 0.25 + g.value * 0.3 + g.trend * 0.1).toFixed(3));
}

/**
 * Snap a rough window to clean boundaries: start where the previous thought ended,
 * end on punctuation or a pause, never on a dangling connector ("dan", "karena", "cara"…).
 * Works without punctuation (many Whisper outputs have none) by using pauses.
 */
export function snapToCompleteThought(
  segments: TranscriptSegment[],
  start: number,
  end: number,
  durationSec: number,
  targetSec: number,
): { start: number; end: number; text: string } {
  if (!segments.length) {
    return { start, end: Math.min(durationSec, end), text: "" };
  }
  const idx = segments.map((_, i) => i);
  const startCands = idx.filter((i) => segments[i].start >= start - 4 && segments[i].start <= start + 4);
  if (!startCands.length) {
    return { start, end: Math.min(durationSec, end), text: "" };
  }
  let i0 = startCands[0];
  let best = -Infinity;
  for (const i of startCands) {
    const q = startQuality(segments, i) - 0.08 * Math.abs(segments[i].start - start);
    if (q > best) {
      best = q;
      i0 = i;
    }
  }
  const s0 = segments[i0];
  const preferredEnd = s0.start + targetSec;
  const minLen = Math.max(12, targetSec - 14);
  const maxLen = targetSec + 14;
  let i1 = -1;
  best = -Infinity;
  for (let i = i0; i < segments.length; i++) {
    const len = segments[i].end - s0.start;
    if (len > maxLen) break;
    if (len < minLen) continue;
    const q = endQuality(segments, i) - 0.04 * Math.abs(segments[i].end - preferredEnd);
    if (q > best) {
      best = q;
      i1 = i;
    }
  }
  if (i1 < 0) {
    // Short tail of the video: take what's left.
    i1 = i0;
    while (i1 + 1 < segments.length && segments[i1 + 1].end - s0.start <= maxLen) i1++;
  }
  const s1 = segments[i1];
  const text = segments
    .slice(i0, i1 + 1)
    .map((s) => s.text)
    .join(" ");
  // Small pads so the first/last word isn't clipped (never into neighbouring speech).
  const prev = segments[i0 - 1];
  const next = segments[i1 + 1];
  const padIn = prev ? Math.min(0.15, Math.max(0, (s0.start - prev.end) / 2)) : 0.15;
  const padOut = next ? Math.min(0.35, Math.max(0, (next.start - s1.end) / 2)) : 0.35;
  const snappedStart = Number(clamp(s0.start - padIn, 0, durationSec).toFixed(2));
  const snappedEnd = Number(clamp(s1.end + padOut, snappedStart + 10, durationSec).toFixed(2));
  return { start: snappedStart, end: snappedEnd, text };
}

/** Build clip windows from transcript with denser virality cues. */
export function windowsFromTranscript(
  segments: TranscriptSegment[],
  durationSec: number,
  targetSec: number,
): ClipCandidate[] {
  if (!segments.length) return [];
  const windows: ClipCandidate[] = [];
  for (let i = 0; i < segments.length; i++) {
    const roughStart = segments[i].start;
    let j = i;
    while (j < segments.length && segments[j].end - roughStart <= targetSec + 14) {
      j++;
      if (segments[Math.min(j, segments.length - 1)].end - roughStart >= targetSec) break;
    }
    const roughEnd = segments[Math.min(j, segments.length - 1)].end;
    const snapped = snapToCompleteThought(segments, roughStart, roughEnd, durationSec, targetSec);
    const dur = snapped.end - snapped.start;
    if (dur < 10 || dur > targetSec + 22) continue;
    const grades = gradeText(snapped.text, snapped.start, snapped.end, durationSec);
    const score = aggregateScore(grades);
    windows.push({
      id: randomUUID(),
      start: snapped.start,
      end: snapped.end,
      score,
      title: hookTitleFromSegments(
        segments.filter((x) => x.start >= snapped.start - 0.2 && x.end <= snapped.end + 0.4),
        titleFromText(snapped.text, `Clip ${windows.length + 1}`),
      ),
      reason: `H${grades.hook}/F${grades.flow}/V${grades.value}/T${grades.trend}`,
      grades,
    });
  }
  return windows;
}

/** Turn silence gaps into speech islands, then slice target-length clips. */
export function windowsFromSilence(
  gaps: SilenceGap[],
  durationSec: number,
  targetSec: number,
): ClipCandidate[] {
  if (durationSec <= 0) return [];
  const sorted = [...gaps].sort((a, b) => a.start - b.start);
  const islands: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const g of sorted) {
    if (g.start > cursor + 2) islands.push({ start: cursor, end: g.start });
    cursor = Math.max(cursor, g.end);
  }
  if (durationSec > cursor + 2) islands.push({ start: cursor, end: durationSec });

  const out: ClipCandidate[] = [];
  for (const island of islands) {
    const len = island.end - island.start;
    if (len < 10) continue;
    if (len <= targetSec + 8) {
      const grades = { hook: 0.35, flow: 0.55, value: 0.4, trend: 0.2 };
      out.push({
        id: randomUUID(),
        start: Number(island.start.toFixed(2)),
        end: Number(island.end.toFixed(2)),
        score: aggregateScore(grades),
        title: `Beat ${out.length + 1}`,
        reason: `speech island ${len.toFixed(1)}s`,
        grades,
      });
      continue;
    }
    const step = Math.max(12, targetSec * 0.65);
    for (let s = island.start; s + 12 <= island.end; s += step) {
      const e = Math.min(island.end, s + targetSec);
      const grades = { hook: 0.3, flow: 0.5, value: 0.35, trend: 0.15 };
      out.push({
        id: randomUUID(),
        start: Number(s.toFixed(2)),
        end: Number(e.toFixed(2)),
        score: aggregateScore(grades),
        title: `Beat ${out.length + 1}`,
        reason: `silence-bounded window`,
        grades,
      });
      if (e >= island.end - 1) break;
    }
  }
  return out;
}

/** Seed candidates around scene cuts. */
export function windowsFromScenes(cuts: SceneCut[], durationSec: number, targetSec: number): ClipCandidate[] {
  const out: ClipCandidate[] = [];
  for (const cut of cuts) {
    const start = clamp(cut.at - 2, 0, Math.max(0, durationSec - 12));
    const end = clamp(start + targetSec, start + 12, durationSec);
    if (end - start < 10) continue;
    const grades = { hook: 0.4, flow: 0.45, value: 0.3, trend: 0.25 };
    out.push({
      id: randomUUID(),
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
      score: aggregateScore(grades),
      title: `Scene ${out.length + 1}`,
      reason: `scene cut @${cut.at.toFixed(1)}s`,
      grades,
    });
  }
  return out;
}

function fallbackWindows(durationSec: number, targetSec: number, maxClips: number): ClipCandidate[] {
  const clips: ClipCandidate[] = [];
  const step = Math.max(targetSec * 0.8, durationSec / Math.max(1, maxClips));
  for (let i = 0; i < maxClips && i * step < durationSec; i++) {
    const start = Math.min(Math.max(0, durationSec - 12), i * step);
    const end = Math.min(durationSec, start + targetSec);
    if (end - start < 8) continue;
    const grades = { hook: 0.2, flow: 0.25, value: 0.2, trend: 0.1 };
    clips.push({
      id: randomUUID(),
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
      score: aggregateScore(grades),
      title: `Clip ${i + 1}`,
      reason: "fallback window",
      grades,
    });
  }
  return clips;
}

export function proposeClips(
  segments: TranscriptSegment[],
  durationSec: number,
  opts: {
    targetSec?: number;
    maxClips?: number;
    silences?: SilenceGap[];
    scenes?: SceneCut[];
  } = {},
): ClipCandidate[] {
  const target = opts.targetSec ?? 40;
  const maxClips = opts.maxClips ?? 8;
  if (durationSec <= 0) return [];

  const speech = windowsFromTranscript(segments, durationSec, target);
  const silence = windowsFromSilence(opts.silences || [], durationSec, target);
  const scenes = windowsFromScenes(opts.scenes || [], durationSec, target);

  const cutTimes = (opts.scenes || []).map((s) => s.at);
  const gapEdges = (opts.silences || []).flatMap((g) => [g.start, g.end]);
  const boost = (c: ClipCandidate) => {
    let s = c.score;
    if (cutTimes.some((t) => Math.abs(t - c.start) < 3 || Math.abs(t - c.end) < 3)) s += 0.08;
    if (gapEdges.some((t) => Math.abs(t - c.start) < 1.5 || Math.abs(t - c.end) < 1.5)) s += 0.06;
    return { ...c, score: Number(Math.min(1, s).toFixed(3)) };
  };

  const pool = [...speech, ...silence, ...scenes].map(boost);
  const ranked = (pool.length ? pool : fallbackWindows(durationSec, target, maxClips)).sort(
    (a, b) => b.score - a.score,
  );

  const picked: ClipCandidate[] = [];
  for (const raw of ranked) {
    if (picked.length >= maxClips) break;
    const w = segments.length ? finalizeWindow(raw, segments, durationSec, target) : raw;
    if (picked.some((p) => overlaps(p, w))) continue;
    picked.push(w);
  }
  return picked.sort((a, b) => a.start - b.start);
}

/** Silence/scene windows get the same clean boundaries + hook title as transcript windows. */
function finalizeWindow(
  c: ClipCandidate,
  segments: TranscriptSegment[],
  durationSec: number,
  target: number,
): ClipCandidate {
  if (!/^(Beat|Scene|Clip) \d+$/.test(c.title)) return c;
  const snapped = snapToCompleteThought(segments, c.start, c.end, durationSec, target);
  const inside = segments.filter((x) => x.start >= snapped.start - 0.2 && x.end <= snapped.end + 0.4);
  if (!inside.length) return c;
  return {
    ...c,
    start: snapped.start,
    end: snapped.end,
    title: hookTitleFromSegments(inside, c.title),
  };
}
