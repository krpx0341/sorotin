import type { TranscriptSegment } from "./types";

export type TranscriptSegmentPatch = {
  /** Index into the studio's transcript array. */
  index: number;
  /** Corrected segment text (whitespace is normalised). */
  text: string;
};

function normaliseText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Apply corrected segment texts to a transcript (transcript-editor backend).
 *
 * - `seg.text` is replaced with the corrected text.
 * - When the segment has word timings and the new text has the SAME number of
 *   words, each word keeps its original start/end (karaoke timing preserved)
 *   and only the word text changes.
 * - When the word count changes (or the segment had no words), timings are
 *   re-spread evenly across the segment span — the same fallback
 *   `wordsForClip` uses for wordless segments.
 * - Out-of-range indexes and empty texts are ignored, never throws.
 * - Returns a new array; the input is not mutated.
 */
export function applyTranscriptPatch(
  transcript: TranscriptSegment[],
  patch: TranscriptSegmentPatch[],
): TranscriptSegment[] {
  const next = transcript.map((seg) => ({
    ...seg,
    words: seg.words ? seg.words.map((w) => ({ ...w })) : undefined,
  }));
  for (const p of patch) {
    const text = normaliseText(p.text);
    if (!text) continue;
    if (!Number.isInteger(p.index) || p.index < 0 || p.index >= next.length) continue;
    const seg = next[p.index];
    const tokens = text.split(" ").filter(Boolean);
    if (!tokens.length) continue;
    seg.text = text;
    const oldWords = seg.words;
    if (oldWords?.length === tokens.length) {
      seg.words = oldWords.map((w, i) => ({ ...w, word: tokens[i] }));
    } else {
      const span = Math.max(0.05, seg.end - seg.start);
      seg.words = tokens.map((word, i) => ({
        start: seg.start + (span * i) / tokens.length,
        end: seg.start + (span * (i + 1)) / tokens.length,
        word,
      }));
    }
  }
  return next;
}
