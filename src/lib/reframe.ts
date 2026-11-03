/** Scene-aware reframing plan (from scripts/face_track.py) → ffmpeg filtergraphs. */

export type CropRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Where the sharp crop sits in the output pane (0..1). Set when the face is on the
   * frame edge and the 9:16 window would otherwise clamp off-centre; the rest of the
   * pane is a blurred fill. Omitted when the crop fills the pane.
   */
  place?: { x: number; y: number; w: number; h: number };
};
export type SegmentLayout = "single" | "dual" | "center";
/** Face box in output-frame coords (0..1). y0/y1 include hair/cap; core_* is brow→chin. */
export type FaceBoxOut = { x0: number; y0: number; x1: number; y1: number; coreY0: number; coreY1: number };
export type ReframeSegment = {
  /** Seconds relative to clip start. */
  start: number;
  end: number;
  layout: SegmentLayout;
  /** single/center: 1 crop; dual: [top (left face), bottom (right face)]. Source pixels. */
  crops: CropRect[];
  /** Faces as they appear in the rendered frame (for caption placement). */
  faceBoxes?: FaceBoxOut[];
};
export type CoverPick = { t: number; segment: number; score: number };

const num = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

function parsePlace(r: Record<string, unknown>): CropRect["place"] | undefined {
  const x = Number(r.place_x);
  const y = Number(r.place_y);
  const w = Number(r.place_w);
  const h = Number(r.place_h);
  if (![x, y, w, h].every((n) => Number.isFinite(n))) return undefined;
  if (w < 0.05 || h < 0.05) return undefined;
  const place = {
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y)),
    w: Math.min(1, Math.max(0, w)),
    h: Math.min(1, Math.max(0, h)),
  };
  if (place.w >= 0.995 && place.h >= 0.995 && place.x <= 0.005 && place.y <= 0.005) return undefined;
  return place;
}

function parseCrop(raw: unknown): CropRect | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const c: CropRect = {
    x: Math.max(0, Math.round(num(r.x))),
    y: Math.max(0, Math.round(num(r.y))),
    w: Math.round(num(r.w)),
    h: Math.round(num(r.h)),
  };
  const place = parsePlace(r);
  if (place) c.place = place;
  return c.w >= 16 && c.h >= 16 ? c : null;
}

function parseFaceBoxes(raw: unknown): FaceBoxOut[] {
  if (!Array.isArray(raw)) return [];
  const c01 = (v: unknown) => Math.min(1, Math.max(0, num(v)));
  return raw
    .filter((b): b is Record<string, unknown> => !!b && typeof b === "object")
    .map((b) => {
      const y0 = c01(b.y0);
      const y1 = c01(b.y1);
      return {
        x0: c01(b.x0),
        x1: c01(b.x1),
        y0,
        y1,
        coreY0: b.core_y0 == null ? y0 : c01(b.core_y0),
        coreY1: b.core_y1 == null ? y1 : c01(b.core_y1),
      };
    })
    .filter((b) => b.x1 > b.x0 && b.y1 > b.y0);
}

/** Validate/normalize segments from face_track JSON; returns [] when unusable. */
export function parseSegments(raw: unknown, allowDual: boolean): ReframeSegment[] {
  if (!Array.isArray(raw)) return [];
  const out: ReframeSegment[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const r = s as Record<string, unknown>;
    const crops = (Array.isArray(r.crops) ? r.crops : []).map(parseCrop).filter((c): c is CropRect => !!c);
    let layout: SegmentLayout = r.layout === "dual" ? "dual" : r.layout === "center" ? "center" : "single";
    if (layout === "dual" && (!allowDual || crops.length < 2)) layout = "single";
    if (!crops.length) return [];
    out.push({
      start: num(r.start),
      end: num(r.end),
      layout,
      crops: layout === "dual" ? crops.slice(0, 2) : crops.slice(0, 1),
      faceBoxes: parseFaceBoxes(r.face_boxes),
    });
  }
  out.sort((a, b) => a.start - b.start);
  // Make segments contiguous from 0 (gaps/overlaps snap to the next start).
  for (let i = 0; i < out.length; i++) {
    if (i === 0) out[i].start = 0;
    if (i > 0) out[i].start = out[i - 1].end;
    if (i < out.length - 1) out[i].end = Math.max(out[i].start, out[i + 1].start);
  }
  return out.filter((s, i) => i === out.length - 1 || s.end - s.start > 0.01);
}

const t3 = (n: number) => Number(n.toFixed(3)).toString();

/** Crop+scale, or blur-fill when the sharp slice only covers part of the pane. */
function paneFilters(c: CropRect, w: number, h: number, input: string, out: string, id: string): string {
  const place = c.place;
  const full = !place || (place.w >= 0.995 && place.h >= 0.995 && place.x <= 0.005 && place.y <= 0.005);
  if (full || !place) {
    return `${input}crop=${c.w}:${c.h}:${c.x}:${c.y},scale=${w}:${h}:flags=lanczos,setsar=1[${out}]`;
  }
  const fgW = Math.max(2, Math.min(w - (w % 2), Math.round((place.w * w) / 2) * 2));
  const fgH = Math.max(2, Math.min(h - (h % 2), Math.round((place.h * h) / 2) * 2));
  const fgX = Math.max(0, Math.min(w - fgW, Math.round(place.x * w)));
  const fgY = Math.max(0, Math.min(h - fgH, Math.round(place.y * h)));
  return (
    `${input}split=2[${id}f][${id}g];` +
    `[${id}f]crop=${c.w}:${c.h}:${c.x}:${c.y},scale=${fgW}:${fgH}:flags=lanczos,setsar=1[${id}fg];` +
    `[${id}g]crop=${c.w}:${c.h}:${c.x}:${c.y},scale=${w}:${h}:flags=fast_bilinear,boxblur=24:2,setsar=1[${id}bg];` +
    `[${id}bg][${id}fg]overlay=${fgX}:${fgY}:format=auto[${out}]`
  );
}

/**
 * Filtergraph for one segment's layout applied to `input`, producing `[out]`.
 * `id` keeps labels unique when several segments share a graph.
 */
export function layoutGraph(seg: ReframeSegment, w: number, h: number, input: string, out: string, id: string) {
  if (seg.layout === "dual" && seg.crops.length >= 2) {
    const half = Math.round(h / 2);
    const [top, bot] = seg.crops;
    return (
      `${input}split=2[${id}a][${id}b];` +
      `${paneFilters(top, w, half, `[${id}a]`, `${id}t`, `${id}t`)};` +
      `${paneFilters(bot, w, h - half, `[${id}b]`, `${id}u`, `${id}u`)};` +
      `[${id}t][${id}u]vstack=inputs=2[${out}]`
    );
  }
  return paneFilters(seg.crops[0], w, h, input, out, id);
}

/**
 * Per-segment trim → crop/scale (single or dual vstack) → concat, ending in `[base]`.
 * Input is `[0:v]` already cut to the clip window (timestamps from 0).
 */
export function buildReframeGraph(segments: ReframeSegment[], w: number, h: number): string {
  if (!segments.length) throw new Error("no segments");
  if (segments.length === 1) {
    return layoutGraph(segments[0], w, h, "[0:v]", "base", "s0");
  }
  const n = segments.length;
  const parts: string[] = [];
  parts.push(`[0:v]split=${n}${segments.map((_, i) => `[in${i}]`).join("")}`);
  segments.forEach((s, i) => {
    const trim: string[] = [];
    if (i > 0) trim.push(`start=${t3(s.start)}`);
    if (i < n - 1) trim.push(`end=${t3(s.end)}`);
    parts.push(`[in${i}]trim=${trim.join(":")},setpts=PTS-STARTPTS[tr${i}]`);
    parts.push(layoutGraph(s, w, h, `[tr${i}]`, `p${i}`, `s${i}`));
  });
  parts.push(`${segments.map((_, i) => `[p${i}]`).join("")}concat=n=${n}:v=1:a=0[base]`);
  return parts.join(";");
}

/** Index of the segment covering clip-relative time t. */
export function segmentAt(segments: ReframeSegment[], t: number): number {
  const i = segments.findIndex((s) => t >= s.start && t < s.end);
  return i >= 0 ? i : Math.max(0, segments.length - 1);
}

export type CaptionPlacement = { start: number; end: number; marginV: number };

const overlap1d = (a0: number, a1: number, b0: number, b1: number) =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/**
 * Bottom edge (0..1) for a caption band of height `bandH` that avoids faces.
 * Cost = face overlap (core brow→chin weighted 4x, hair/cap 1x) + distance from `preferBottom`.
 * Candidates are limited to [minTop, maxBottom] (hook title on top, platform UI at bottom).
 */
export function pickCaptionBottom(
  faces: FaceBoxOut[],
  opts: { bandH: number; preferBottom: number; minTop?: number; maxBottom?: number; bandX0?: number; bandX1?: number },
): number {
  const { bandH, preferBottom } = opts;
  const minTop = opts.minTop ?? 0.12;
  const maxBottom = opts.maxBottom ?? 0.88;
  const bx0 = opts.bandX0 ?? 0.08;
  const bx1 = opts.bandX1 ?? 0.92;
  let best = preferBottom;
  let bestCost = Infinity;
  for (let yb = minTop + bandH; yb <= maxBottom + 1e-9; yb += 0.005) {
    const y0 = yb - bandH;
    let cost = 0;
    for (const f of faces) {
      const hx = overlap1d(bx0, bx1, f.x0, f.x1) / Math.max(1e-6, f.x1 - f.x0);
      if (hx <= 0) continue;
      cost += hx * ((4 * overlap1d(y0, yb, f.coreY0, f.coreY1) + overlap1d(y0, yb, f.y0, f.y1)) / bandH);
    }
    cost += 0.25 * Math.abs(yb - preferBottom);
    if (cost < bestCost - 1e-9) {
      bestCost = cost;
      best = yb;
    }
  }
  return best;
}

/**
 * Per-shot caption MarginV (alignment 2 = bottom-centre).
 * Single/center shots keep `defaultMarginV`; split shots move the band to the
 * least face-covering spot, preferring the seam between the two panes.
 */
export function captionPlacements(
  segments: ReframeSegment[],
  opts: { playResY: number; defaultMarginV: number; bandH: number },
): CaptionPlacement[] {
  const { playResY, defaultMarginV, bandH } = opts;
  return segments.map((s) => {
    if (s.layout !== "dual" || !s.faceBoxes?.length) {
      return { start: s.start, end: s.end, marginV: defaultMarginV };
    }
    const bottom = pickCaptionBottom(s.faceBoxes, { bandH, preferBottom: 0.5 });
    return { start: s.start, end: s.end, marginV: Math.max(1, Math.round((1 - bottom) * playResY)) };
  });
}

/**
 * Where to put the hook card (top, normalized) during the first seconds: as high as possible
 * (below platform UI) but never over a face; drops below the faces if the top is occupied.
 */
export function pickHookTop(
  segments: ReframeSegment[],
  opts: { cardH: number; cardW: number; hookSec: number; preferTop?: number },
): number {
  const preferTop = opts.preferTop ?? 0.085;
  const inWindow = segments.filter((s) => s.start < opts.hookSec);
  const faces = inWindow.flatMap((s) => s.faceBoxes || []);
  if (!faces.length) return preferTop;
  const dual = inWindow.some((s) => s.layout === "dual");
  const half = Math.min(0.5, opts.cardW / 2);
  const bottom = pickCaptionBottom(faces, {
    bandH: opts.cardH,
    preferBottom: preferTop + opts.cardH,
    minTop: 0.06,
    // keep clear of captions: bottom band (~0.62+) or the split seam (~0.45+)
    maxBottom: dual ? 0.46 : 0.62,
    bandX0: 0.5 - half,
    bandX1: 0.5 + half,
  });
  return Math.max(0.06, bottom - opts.cardH);
}
