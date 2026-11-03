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
 * How far a rough cut may move to reach a sentence boundary or a natural pause.
 * Wider than the old ±4s segment search: Whisper often splits a sentence across
 * segments, so the real boundary sits a few seconds off the segment start
 * (the local picker used to begin on the fragment).
 */
export const BOUNDARY_TOLERANCE_SEC = 6;

/** Silence / breath longer than this is a natural cut. Matches ffmpeg silencedetect `d=0.45`. */
const PAUSE_GAP_SEC = 0.45;

/** Same window the local picker already used around `targetSec` (before edge pads). */
export function clipDurationLimits(targetSec: number): { min: number; max: number } {
  return { min: Math.max(12, targetSec - 14), max: targetSec + 14 };
}

type SpeechAtom = { start: number; end: number; text: string };

const ELLIPSIS_END = /(\.\.\.|…)["')\]]*$/;
const SENTENCE_END = /[.!?]["')\]]*$/;
const ABBREV_END = /^(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|fig|no|vol|approx)\.$/i;

/** A real sentence end, not a Whisper trail-off ("...") or a title abbreviation ("Dr."). */
function sentenceEnded(text: string): boolean {
  const t = text.trim();
  if (!t || ELLIPSIS_END.test(t)) return false;
  if (/^[A-Za-z]\.$/.test(t) || ABBREV_END.test(t)) return false;
  return SENTENCE_END.test(t);
}

/**
 * Words when Whisper gave timestamps; otherwise the whole segment is one atom
 * (punctuation-free transcripts still snap on pauses between segments).
 */
function speechAtoms(segments: TranscriptSegment[]): SpeechAtom[] {
  const atoms: SpeechAtom[] = [];
  for (const seg of segments) {
    const words = (seg.words || []).filter(
      (w) => w.word.trim() && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start,
    );
    if (words.length) {
      for (const w of words) atoms.push({ start: w.start, end: w.end, text: w.word.trim() });
    } else {
      const text = norm(seg.text);
      if (!text || !(seg.end > seg.start)) continue;
      atoms.push({ start: seg.start, end: seg.end, text });
    }
  }
  atoms.sort((a, b) => a.start - b.start || a.end - b.end);
  return atoms;
}

function nearSilence(silences: SilenceGap[] | undefined, t: number, edge: "start" | "end"): boolean {
  if (!silences?.length) return false;
  return silences.some((g) => Math.abs((edge === "start" ? g.end : g.start) - t) <= 0.3);
}

function atomStartScore(atoms: SpeechAtom[], i: number, silences?: SilenceGap[]): number {
  const a = atoms[i];
  const prev = atoms[i - 1];
  const gap = prev ? a.start - prev.end : 2;
  let q = Math.min(1, Math.max(0, gap) / 0.8);
  // Beginning of the source counts as a boundary. A synthetic "gap" there is not a pause.
  if (!prev || sentenceEnded(prev.text)) q += 2.5;
  if (prev && gap >= PAUSE_GAP_SEC) q += 1.2;
  if (nearSilence(silences, a.start, "start")) q += 0.8;
  const text = norm(a.text);
  if (CONNECTOR_START.test(text)) q -= 0.5;
  if (FILLER_EDGE.test(text) && text.split(" ").length <= 2) q -= 0.3;
  return q;
}

function atomEndScore(atoms: SpeechAtom[], i: number, silences?: SilenceGap[]): number {
  const a = atoms[i];
  const next = atoms[i + 1];
  const gap = next ? next.start - a.end : 2;
  const text = norm(a.text);
  let q = Math.min(1, Math.max(0, gap) / 0.8);
  if (ELLIPSIS_END.test(text)) q -= 0.6;
  else if (sentenceEnded(a.text)) q += /\?["')\]]*$/.test(text) ? 1.4 : 2.5;
  if (next && gap >= PAUSE_GAP_SEC) q += 1.0;
  if (!next) q += 0.4;
  if (nearSilence(silences, a.end, "end")) q += 0.6;
  if (CONNECTOR_END.test(text.replace(/[.,!?…]+$/, ""))) q -= 0.9;
  return q;
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

/**
 * Snap a rough window onto sentence boundaries or natural pauses.
 * Atoms are word timestamps when the transcript has them, else segments.
 * The cut never falls inside a word: pads stay inside the surrounding gap.
 * Duration stays inside {@link clipDurationLimits} when the source is long enough;
 * a clip pressed against the end of the file may be shorter than the minimum.
 */
export function snapToCompleteThought(
  segments: TranscriptSegment[],
  start: number,
  end: number,
  durationSec: number,
  targetSec: number,
  silences?: SilenceGap[],
): { start: number; end: number; text: string } {
  const atoms = speechAtoms(segments);
  if (!atoms.length) {
    const s = round2(clamp(start, 0, Math.max(0, durationSec)));
    const e = round2(clamp(end, s, Math.max(s, durationSec)));
    return { start: s, end: e, text: "" };
  }
  const { min: minLen, max: maxLen } = clipDurationLimits(targetSec);
  const tol = BOUNDARY_TOLERANCE_SEC;
  const roughStart = clamp(start, 0, Math.max(0, durationSec));

  const startCands: number[] = [];
  for (let i = 0; i < atoms.length; i++) {
    const t = atoms[i].start;
    if (t >= roughStart - tol && t <= roughStart + tol) startCands.push(i);
  }
  if (!startCands.length) {
    // Rough cut landed in a long atom (no word timestamps) or a gap. Snap to that
    // atom's edges so the timestamp is not left mid-word.
    const inside = atoms.findIndex((a) => roughStart > a.start && roughStart < a.end);
    if (inside >= 0) startCands.push(inside);
  }
  if (!startCands.length) {
    const s = round2(clamp(roughStart, 0, Math.max(0, durationSec)));
    const e = round2(clamp(Math.max(end, s), s, Math.max(s, durationSec)));
    return { start: s, end: e, text: "" };
  }

  let i0 = startCands[0];
  let best = -Infinity;
  for (const i of startCands) {
    let q = atomStartScore(atoms, i, silences) - 0.08 * Math.abs(atoms[i].start - roughStart);
    if (durationSec - atoms[i].start < minLen) q -= 3;
    if (q > best) {
      best = q;
      i0 = i;
    }
  }

  const s0 = atoms[i0];
  const preferredEnd = s0.start + targetSec;
  let i1 = -1;
  best = -Infinity;
  for (let i = i0; i < atoms.length; i++) {
    if (atoms[i].start - s0.start > maxLen) break;
    const len = atoms[i].end - s0.start;
    if (len < minLen || len > maxLen) continue;
    if (atoms[i].end > durationSec + 0.001) continue;
    const q = atomEndScore(atoms, i, silences) - 0.04 * Math.abs(atoms[i].end - preferredEnd);
    if (q > best) {
      best = q;
      i1 = i;
    }
  }
  if (i1 < 0) {
    // Not enough media left for a full clip (near the end) or one unsplittable atom.
    i1 = i0;
    while (
      i1 + 1 < atoms.length &&
      atoms[i1 + 1].end - s0.start <= maxLen &&
      atoms[i1 + 1].end <= durationSec + 0.001
    ) {
      i1++;
    }
  }

  const s1 = atoms[i1];
  const prev = atoms[i0 - 1];
  const next = atoms[i1 + 1];
  let padIn = prev ? Math.min(0.15, Math.max(0, (s0.start - prev.end) / 2)) : Math.min(0.15, s0.start);
  let padOut = next ? Math.min(0.35, Math.max(0, (next.start - s1.end) / 2)) : Math.min(0.35, Math.max(0, durationSec - s1.end));
  const span = s1.end - s0.start;
  const padRoom = Math.max(0, maxLen - span);
  if (padIn + padOut > padRoom) {
    const over = padIn + padOut - padRoom;
    const cutOut = Math.min(padOut, over);
    padOut -= cutOut;
    padIn = Math.max(0, padIn - (over - cutOut));
  }

  let snappedStart = clamp(s0.start - padIn, 0, Math.max(0, durationSec));
  let snappedEnd = Math.min(durationSec, s1.end + padOut);
  // Two-decimal clip times must not step into a word. Start rounds backward
  // (into the gap); end rounds forward. If that still lands inside the atom,
  // keep the atom edge itself.
  snappedStart = Math.min(snappedStart, s0.start);
  snappedEnd = Math.max(snappedEnd, Math.min(durationSec, s1.end));
  snappedStart = round2(snappedStart);
  snappedEnd = round2(snappedEnd);
  if (snappedStart > s0.start) snappedStart = s0.start;
  if (snappedEnd < s1.end && snappedEnd < durationSec) snappedEnd = Math.min(durationSec, s1.end);
  if (snappedEnd < snappedStart) snappedEnd = snappedStart;

  const text = atoms
    .slice(i0, i1 + 1)
    .map((a) => a.text)
    .join(" ");
  return { start: snappedStart, end: snappedEnd, text };
}

/** Build clip windows from transcript with denser virality cues. */
export function windowsFromTranscript(
  segments: TranscriptSegment[],
  durationSec: number,
  targetSec: number,
  silences?: SilenceGap[],
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
    const snapped = snapToCompleteThought(segments, roughStart, roughEnd, durationSec, targetSec, silences);
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
        snapped.text ? [{ start: snapped.start, end: snapped.end, text: snapped.text }] : [],
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

  const speech = windowsFromTranscript(segments, durationSec, target, opts.silences);
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
  const finalized = (pool.length ? pool : fallbackWindows(durationSec, target, maxClips)).map((raw) => {
    const w = segments.length ? finalizeWindow(raw, segments, durationSec, target, opts.silences) : raw;
    return preferCleanBoundaries(w, segments, opts.silences);
  });
  const ranked = finalized.sort((a, b) => b.score - a.score);

  const picked: ClipCandidate[] = [];
  for (const w of ranked) {
    if (picked.length >= maxClips) break;
    if (picked.some((p) => overlaps(p, w))) continue;
    picked.push(w);
  }
  return picked.sort((a, b) => a.start - b.start);
}

/**
 * A window that still starts (or ends) mid-sentence loses to one that lands on a
 * sentence or a pause when both describe overlapping moments. Word edges stay
 * legal — a very long sentence may have nothing else inside the duration cap —
 * but they no longer outrank a clean cut.
 */
function preferCleanBoundaries(
  clip: ClipCandidate,
  segments: TranscriptSegment[],
  silences?: SilenceGap[],
): ClipCandidate {
  if (!segments.length) return clip;
  const atoms = speechAtoms(segments);
  if (!atoms.length) return clip;
  const open = boundaryAt(atoms, clip.start, "start", silences);
  const close = boundaryAt(atoms, clip.end, "end", silences);
  const factor = (open ? 1 : 0.25) * (close ? 1 : 0.75);
  if (factor === 1) return clip;
  return { ...clip, score: Number(Math.min(1, clip.score * factor).toFixed(3)) };
}

function boundaryAt(
  atoms: SpeechAtom[],
  t: number,
  edge: "start" | "end",
  silences?: SilenceGap[],
): boolean {
  if (edge === "start") {
    let idx = -1;
    for (let i = 0; i < atoms.length; i++) {
      if (atoms[i].end > t + 0.03 && atoms[i].start >= t - 0.25) {
        idx = i;
        break;
      }
    }
    if (idx < 0) return true;
    const prev = atoms[idx - 1];
    if (!prev || sentenceEnded(prev.text)) return true;
    if (atoms[idx].start - prev.end >= PAUSE_GAP_SEC) return true;
    return nearSilence(silences, atoms[idx].start, "start");
  }
  let idx = -1;
  for (let i = 0; i < atoms.length; i++) {
    if (atoms[i].start < t - 0.03 && atoms[i].end <= t + 0.25) idx = i;
  }
  if (idx < 0) return true;
  const a = atoms[idx];
  const next = atoms[idx + 1];
  if (sentenceEnded(a.text)) return true;
  if (!next) return true;
  if (next.start - a.end >= PAUSE_GAP_SEC) return true;
  return nearSilence(silences, a.end, "end");
}

/** Silence/scene windows get the same clean boundaries + hook title as transcript windows. */
function finalizeWindow(
  c: ClipCandidate,
  segments: TranscriptSegment[],
  durationSec: number,
  target: number,
  silences?: SilenceGap[],
): ClipCandidate {
  if (!/^(Beat|Scene|Clip) \d+$/.test(c.title)) return c;
  const snapped = snapToCompleteThought(segments, c.start, c.end, durationSec, target, silences);
  if (!snapped.text.trim()) return c;
  return {
    ...c,
    start: snapped.start,
    end: snapped.end,
    title: hookTitleFromSegments([{ start: snapped.start, end: snapped.end, text: snapped.text }], c.title),
  };
}
