import { randomUUID } from "node:crypto";
import type { ClipCandidate, TranscriptSegment } from "./types";

export type SilenceGap = { start: number; end: number };
export type SceneCut = { at: number };

const HOOK_WORDS =
  /[!?]|viral|tips|cara|rahasia|penting|jangan|ternyata|akhirnya|shock|gila|wow|must|never|secret|hack|why|how to|mistake|warning|stop|wait|listen|break|best|worst|rahasia|bongkar|fakta|hati-hati|wajib|langsung/gi;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function overlaps(a: ClipCandidate, b: ClipCandidate, ratio = 0.4) {
  const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  return overlap > (a.end - a.start) * ratio;
}

function titleFromText(text: string, fallback: string) {
  const t = text.replace(/\s+/g, " ").trim();
  return (t.slice(0, 72) || fallback).trim();
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
    const start = segments[i].start;
    let end = start;
    let text = "";
    let j = i;
    while (j < segments.length && segments[j].end - start <= targetSec + 12) {
      end = segments[j].end;
      text += (text ? " " : "") + segments[j].text;
      j++;
      if (end - start >= targetSec) break;
    }
    const dur = end - start;
    if (dur < 10 || dur > targetSec + 20) continue;
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const dens = words / Math.max(1, dur);
    const bang = (text.match(HOOK_WORDS) || []).length;
    const question = /\?|mengapa|kenapa|why|how/i.test(text) ? 0.35 : 0;
    const earlyHook = start < durationSec * 0.15 ? 0.15 : 0;
    const score = dens * 0.55 + bang * 0.45 + Math.min(1, words / 35) * 0.25 + question + earlyHook;
    windows.push({
      id: randomUUID(),
      start: Number(start.toFixed(2)),
      end: Number(Math.min(durationSec, end).toFixed(2)),
      score: Number(score.toFixed(3)),
      title: titleFromText(text, `Clip ${windows.length + 1}`),
      reason: `speech dens=${dens.toFixed(2)} hooks=${bang}`,
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
      out.push({
        id: randomUUID(),
        start: Number(island.start.toFixed(2)),
        end: Number(island.end.toFixed(2)),
        score: 0.55 + Math.min(0.3, len / 120),
        title: `Beat ${out.length + 1}`,
        reason: `speech island ${len.toFixed(1)}s`,
      });
      continue;
    }
    // slide windows across long islands
    const step = Math.max(12, targetSec * 0.65);
    for (let s = island.start; s + 12 <= island.end; s += step) {
      const e = Math.min(island.end, s + targetSec);
      out.push({
        id: randomUUID(),
        start: Number(s.toFixed(2)),
        end: Number(e.toFixed(2)),
        score: 0.5,
        title: `Beat ${out.length + 1}`,
        reason: `silence-bounded window`,
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
    out.push({
      id: randomUUID(),
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
      score: 0.48,
      title: `Scene ${out.length + 1}`,
      reason: `scene cut @${cut.at.toFixed(1)}s`,
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

  // Boost candidates that sit near scene cuts or silence boundaries.
  const cutTimes = (opts.scenes || []).map((s) => s.at);
  const gapEdges = (opts.silences || []).flatMap((g) => [g.start, g.end]);
  const boost = (c: ClipCandidate) => {
    let s = c.score;
    if (cutTimes.some((t) => Math.abs(t - c.start) < 3 || Math.abs(t - c.end) < 3)) s += 0.25;
    if (gapEdges.some((t) => Math.abs(t - c.start) < 1.5 || Math.abs(t - c.end) < 1.5)) s += 0.2;
    return { ...c, score: Number(s.toFixed(3)) };
  };

  const pool = [...speech, ...silence, ...scenes].map(boost);
  const ranked = (pool.length ? pool : fallbackWindows(durationSec, target, maxClips)).sort(
    (a, b) => b.score - a.score,
  );

  const picked: ClipCandidate[] = [];
  for (const w of ranked) {
    if (picked.length >= maxClips) break;
    if (picked.some((p) => overlaps(p, w))) continue;
    picked.push(w);
  }
  return picked.sort((a, b) => a.start - b.start);
}
