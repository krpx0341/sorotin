/**
 * Horizontal advances for Noto Sans Black, ASCII 32..126, in font units (em = 1000).
 * Used to predict caption wrap and hook-card fit without spawning Pillow.
 */
const ADV = [
  260, 290, 524, 662, 577, 948, 799, 292, 359, 359, 537, 586, 309, 318, 289, 442, 586, 586, 586, 586,
  586, 586, 586, 586, 586, 586, 289, 297, 586, 586, 586, 505, 897, 726, 674, 649, 734, 549, 539, 740,
  766, 440, 352, 687, 582, 967, 834, 797, 632, 797, 677, 577, 591, 757, 694, 1039, 723, 664, 611, 324,
  442, 324, 525, 500, 418, 623, 643, 539, 643, 618, 413, 643, 670, 325, 324, 659, 323, 1000, 670, 637,
  643, 643, 469, 517, 460, 670, 611, 910, 630, 610, 507, 433, 509, 433, 586,
];

/** usWinAscent + usWinDescent. libass REAL_DIM maps this sum onto Fontsize. */
export const NOTO_WIN_UNITS = 1519;

/** Advance width in pixels at a nominal em size (Pillow / drawtext). */
export function notoNominalWidth(text: string, fontPx: number): number {
  let w = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 32;
    const units = c >= 32 && c < 127 ? ADV[c - 32] : 640;
    w += (units * fontPx) / 1000;
  }
  return w;
}

/** Advance width in libass pixels (FT_SIZE_REQUEST_TYPE_REAL_DIM). */
export function notoRealDimWidth(text: string, fontPx: number, scale = 1): number {
  return notoNominalWidth(text, (fontPx * 1000 * scale) / NOTO_WIN_UNITS);
}
