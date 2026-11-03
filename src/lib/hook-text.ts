import { notoNominalWidth } from "./noto-metrics";

/**
 * Wrap a hook into the on-screen card. The card grows with the line count and the
 * font shrinks down to the same floor hook_card.py uses. An ellipsis is added only
 * when the text still cannot fit at that floor.
 */
export function fitHookText(text: string, frameW = 1080, frameH = 1920, maxLines = 3): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return clean;
  if (hookFits(clean, frameW, frameH, maxLines)) return clean;
  const words = clean.split(" ");
  for (let n = words.length - 1; n >= 1; n--) {
    const cut = `${words.slice(0, n).join(" ").replace(/[,:;]+$/, "")}…`;
    if (hookFits(cut, frameW, frameH, maxLines)) return cut;
  }
  return `${words[0]}…`;
}

function hookFits(text: string, frameW: number, frameH: number, maxLines: number): boolean {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const base = Math.min(frameW, frameH);
  const maxW = frameW * 0.88;
  const top = Math.floor(base * 0.066);
  const minSize = Math.max(18, Math.floor(base * 0.036));
  const passes: Array<[number, number]> = [
    [Math.min(2, maxLines), Math.floor(base * 0.052)],
    [maxLines, minSize],
  ];
  for (const [linesAllowed, floor] of passes) {
    for (let size = top; size >= floor; size -= 2) {
      const padX = Math.floor(size * 0.62);
      const limit = maxW - 2 * padX;
      const lines = bestWrap(words, size, linesAllowed, limit);
      if (!lines) continue;
      const widest = Math.max(...lines.map((ln) => notoNominalWidth(ln, size)));
      if (widest + 2 * padX <= maxW + 0.5) return true;
    }
  }
  return false;
}

/** Fewest lines whose widest line is within `limit`; null when none are. */
function bestWrap(words: string[], fontPx: number, maxLines: number, limit: number): string[] | null {
  const n = words.length;
  const kMax = Math.min(maxLines, n);
  for (let k = 1; k <= kMax; k++) {
    const lines = narrowest(words, fontPx, k);
    const widest = Math.max(...lines.map((ln) => notoNominalWidth(ln, fontPx)));
    if (widest <= limit + 0.5) return lines;
  }
  return null;
}

function narrowest(words: string[], fontPx: number, k: number): string[] {
  const n = words.length;
  if (k <= 1) return [words.join(" ")];
  let best: string[] = [words.join(" ")];
  let bestW = Infinity;
  const cuts: number[] = [];
  const choose = (start: number, left: number) => {
    if (left === 0) {
      const idx = [0, ...cuts, n];
      const lines = idx.slice(0, -1).map((a, i) => words.slice(a, idx[i + 1]).join(" "));
      const widest = Math.max(...lines.map((ln) => notoNominalWidth(ln, fontPx)));
      if (widest < bestW) {
        bestW = widest;
        best = lines;
      }
      return;
    }
    for (let i = start; i <= n - left; i++) {
      cuts.push(i);
      choose(i + 1, left - 1);
      cuts.pop();
    }
  };
  choose(1, k - 1);
  return best;
}
