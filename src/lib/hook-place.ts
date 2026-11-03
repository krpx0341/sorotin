import { captionFontSize, defaultCaptionMarginV } from "./captions";
import { NOTO_WIN_UNITS } from "./noto-metrics";
import type { ReframeSegment } from "./reframe";

/** Noto Sans Black cap height, in the same units as the OS/2 win metrics. */
const CAP_UNITS = 714;
const WIN_DESCENT = 395;
const POP = 1.18;
const OUTLINE_PX = 5;
/** Keep the card a few pixels off the caption ink. */
const CAPTION_PAD = 0.004;

/**
 * Top of the burned-in caption ink (0 = frame top), for `lines` of karaoke.
 * Matches libass 0.17 REAL_DIM on Noto Sans Black: the popped word (118%) and
 * the outline set the first line's top, and each extra line adds one font box.
 */
export function captionInkTop(playResY: number, lines: number): number {
  const font = captionFontSize(playResY);
  const anchor = playResY - defaultCaptionMarginV(playResY);
  const inkBottom = anchor - (WIN_DESCENT / NOTO_WIN_UNITS) * font;
  const poppedCap = (CAP_UNITS / NOTO_WIN_UNITS) * font * POP + OUTLINE_PX;
  const n = Math.max(1, Math.round(lines));
  const top = inkBottom - poppedCap - (n - 1) * font;
  return Math.max(0, Math.min(1, top / playResY));
}

export type HookPlan = { top: number; cardH: number };

/**
 * Place the hook card so it misses the face core and the caption ink.
 * Prefers the platform-safe top when that slot is clear; otherwise sits as
 * low as the caption allows. When the full card cannot fit, it shrinks into
 * the tallest clear gap (above the head, or between the chin and the caption).
 */
export function placeHookCard(
  segments: ReframeSegment[],
  opts: {
    cardH: number;
    cardW: number;
    hookSec: number;
    preferTop?: number;
    captionTop: number;
    minCardH?: number;
  },
): HookPlan {
  const preferTop = opts.preferTop ?? 0.085;
  const minTop = 0.06;
  const cardH = Math.max(0.02, opts.cardH);
  const minCardH = Math.min(cardH, opts.minCardH ?? 0.045);
  const limit = Math.min(0.96, opts.captionTop) - CAPTION_PAD;
  const half = Math.min(0.5, opts.cardW / 2);
  const x0 = 0.5 - half;
  const x1 = 0.5 + half;
  const blocked = segments
    .filter((s) => s.start < opts.hookSec)
    .flatMap((s) => s.faceBoxes ?? [])
    .filter((f) => overlaps(x0, x1, f.x0, f.x1))
    .map((f) => [f.coreY0, f.coreY1] as [number, number]);

  const gaps = freeGaps(blocked, minTop, Math.max(minTop, limit));

  if (slotFree(preferTop, cardH, minTop, limit, blocked)) {
    return { top: preferTop, cardH };
  }

  const full: number[] = [];
  for (const [a, b] of gaps) {
    if (b - a >= cardH - 1e-6) full.push(b - cardH);
  }
  if (full.length) return { top: Math.max(...full), cardH };

  let best: HookPlan | null = null;
  for (const [a, b] of gaps) {
    const h = Math.min(cardH, b - a);
    if (h < minCardH - 1e-6) continue;
    const top = b - h;
    if (!best || h > best.cardH + 1e-6 || (Math.abs(h - best.cardH) < 1e-6 && top < best.top)) {
      best = { top, cardH: h };
    }
  }
  if (best) return best;

  const h = Math.min(cardH, Math.max(minCardH, limit - minTop));
  return { top: minTop, cardH: Math.max(0.02, h) };
}

function overlaps(a0: number, a1: number, b0: number, b1: number) {
  return Math.min(a1, b1) - Math.max(a0, b0) > 1e-4;
}

function slotFree(top: number, h: number, minTop: number, limit: number, blocked: Array<[number, number]>) {
  if (top < minTop - 1e-6 || top + h > limit + 1e-6) return false;
  return !blocked.some(([a, b]) => overlaps(top, top + h, a, b));
}

function freeGaps(blocked: Array<[number, number]>, lo: number, hi: number): Array<[number, number]> {
  if (hi - lo < 1e-4) return [];
  const cuts = blocked
    .map(([a, b]) => [Math.max(lo, a), Math.min(hi, b)] as [number, number])
    .filter(([a, b]) => b - a > 1e-4)
    .sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const c of cuts) {
    const last = merged[merged.length - 1];
    if (!last || c[0] > last[1]) merged.push([c[0], c[1]]);
    else last[1] = Math.max(last[1], c[1]);
  }
  const gaps: Array<[number, number]> = [];
  let cursor = lo;
  for (const [a, b] of merged) {
    if (a - cursor > 1e-4) gaps.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (hi - cursor > 1e-4) gaps.push([cursor, hi]);
  return gaps;
}
