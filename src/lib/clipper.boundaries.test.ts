import { describe, expect, it } from "vitest";
import { BOUNDARY_TOLERANCE_SEC, clipDurationLimits, proposeClips, snapToCompleteThought } from "./clipper";
import { clipText, localHookLine } from "./scoring";
import type { TranscriptSegment, TranscriptWord } from "./types";

function word(start: number, end: number, text: string): TranscriptWord {
  return { start, end, word: text };
}

function asSegment(words: TranscriptWord[]): TranscriptSegment {
  return {
    start: words[0].start,
    end: words[words.length - 1].end,
    text: words.map((w) => w.word).join(" "),
    words,
  };
}

/** Adjacent words, `step` seconds each, starting at `from`. */
function packed(from: number, tokens: string[], step = 0.4): TranscriptWord[] {
  return tokens.map((text, i) => word(round3(from + i * step), round3(from + (i + 1) * step), text));
}

function round3(n: number) {
  return Number(n.toFixed(3));
}

/** A word that overlaps the clip must be fully inside it. */
function assertWordsIntact(start: number, end: number, words: TranscriptWord[]) {
  for (const w of words) {
    expect(start > w.start + 0.001 && start < w.end - 0.001, `start ${start} cuts "${w.word}" ${w.start}-${w.end}`).toBe(
      false,
    );
    expect(end > w.start + 0.001 && end < w.end - 0.001, `end ${end} cuts "${w.word}" ${w.end}`).toBe(false);
    const overlaps = w.end > start + 0.001 && w.start < end - 0.001;
    if (!overlaps) continue;
    expect(w.start).toBeGreaterThanOrEqual(start - 0.001);
    expect(w.end).toBeLessThanOrEqual(end + 0.001);
  }
}

function assertDuration(start: number, end: number, durationSec: number, targetSec: number, opts?: { allowShort?: boolean }) {
  const { min, max } = clipDurationLimits(targetSec);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeLessThanOrEqual(durationSec + 0.001);
  expect(end).toBeGreaterThan(start);
  expect(end - start).toBeLessThanOrEqual(max + 0.02);
  if (!opts?.allowShort) expect(end - start).toBeGreaterThanOrEqual(min - 0.02);
}

describe("local moment picker boundaries", () => {
  it("starts on a sentence boundary inside the tolerance window, not mid-sentence", () => {
    // QA shape: Whisper split "…Communications | Commission in the United States. And…"
    const words: TranscriptWord[] = [
      word(0, 0.4, "Well"),
      word(0.4, 5.5, "Communications"),
      word(5.5, 6.3, "Commission"),
      word(6.3, 6.7, "in"),
      word(6.7, 7.1, "the"),
      word(7.1, 7.54, "States."),
      word(8.28, 8.6, "And"),
    ];
    let t = 8.6;
    while (t < 36.6) {
      words.push(word(round3(t), round3(t + 0.4), `w${words.length}`));
      t = round3(t + 0.4);
    }
    const clear = word(round3(t), round3(t + 0.5), "clear.");
    words.push(clear);
    words.push(word(round3(clear.end + 0.2), round3(clear.end + 0.7), "Next"));
    words.push(...packed(clear.end + 0.7, ["sentence", "keeps", "going", "awhile"]));

    const rough = 5.5;
    const target = 30;
    const duration = 80;
    expect(8.28 - rough).toBeLessThanOrEqual(BOUNDARY_TOLERANCE_SEC);
    expect(8.28 - rough).toBeGreaterThan(0);

    const snapped = snapToCompleteThought([asSegment(words)], rough, rough + target, duration, target);
    expect(snapped.start).toBeGreaterThan(7.54);
    expect(snapped.start).toBeLessThanOrEqual(8.28);
    expect(snapped.text.toLowerCase().startsWith("and ")).toBe(true);
    expect(snapped.text.toLowerCase().includes("commission")).toBe(false);
    expect(snapped.text.toLowerCase()).toContain("clear.");
    expect(snapped.end).toBeGreaterThan(clear.start);
    expect(snapped.end).toBeLessThan(clear.end + 0.36);
    assertWordsIntact(snapped.start, snapped.end, words);
    assertDuration(snapped.start, snapped.end, duration, target);

    const segments = [asSegment(words)];
    const spoken = clipText(segments, snapped.start, snapped.end);
    expect(spoken.toLowerCase().startsWith("and ")).toBe(true);
    expect(spoken.toLowerCase()).not.toContain("commission");
    const hook = localHookLine(snapped.text, segments, snapped.start, snapped.end);
    expect(hook.toLowerCase()).not.toContain("commission in the united states");
  });

  it("snaps a cut 4.6s into a sentence back to that sentence when it is inside the window", () => {
    // QA clip2: "economist. [8s pause] Well … that | when I was at the FCC … regulation. … today."
    const words: TranscriptWord[] = [word(69.42, 69.92, "economist."), word(77.88, 78.3, "Well")];
    let t = 78.3;
    while (t < 82.48) {
      words.push(word(round3(t), round3(Math.min(82.48, t + 0.4)), `lead${words.length}`));
      t = round3(t + 0.4);
    }
    words.push(word(82.48, 83.0, "when"));
    t = 83;
    while (t < 119.4) {
      words.push(word(round3(t), round3(t + 0.4), `body${words.length}`));
      t = round3(t + 0.4);
    }
    const regulation = word(119.8, 120.42, "regulation.");
    words.push(regulation);
    // Next sentence end would push the clip past target+14. It must be left out.
    words.push(word(122.6, 123.1, "today."));

    const rough = 82.48;
    expect(rough - 77.88).toBeLessThanOrEqual(BOUNDARY_TOLERANCE_SEC);
    expect(rough - 69.92).toBeGreaterThan(BOUNDARY_TOLERANCE_SEC);

    const target = 30;
    const duration = 235;
    const snapped = snapToCompleteThought([asSegment(words)], rough, rough + 40, duration, target);
    expect(snapped.start).toBeGreaterThan(69.92);
    expect(snapped.start).toBeLessThanOrEqual(77.88);
    expect(snapped.text.toLowerCase().startsWith("well ")).toBe(true);
    expect(snapped.text.toLowerCase().startsWith("when ")).toBe(false);
    expect(snapped.text.toLowerCase()).toContain("regulation.");
    expect(snapped.text.toLowerCase()).not.toContain("today");
    assertWordsIntact(snapped.start, snapped.end, words);
    assertDuration(snapped.start, snapped.end, duration, target);
    expect(snapped.end).toBeLessThanOrEqual(77.88 + clipDurationLimits(target).max + 0.02);
  });

  it("does not jump to a sentence boundary outside the tolerance window", () => {
    const words: TranscriptWord[] = [word(0, 0.4, "Hello.")];
    words.push(...packed(0.5, Array.from({ length: 200 }, (_, i) => `w${i}`), 0.4));
    const rough = 20;
    const target = 30;
    const duration = 120;
    const snapped = snapToCompleteThought([asSegment(words)], rough, rough + target, duration, target);
    expect(snapped.start).toBeGreaterThanOrEqual(rough - BOUNDARY_TOLERANCE_SEC - 0.05);
    expect(snapped.start).toBeLessThanOrEqual(rough + BOUNDARY_TOLERANCE_SEC + 0.05);
    expect(snapped.start).toBeGreaterThan(5);
    expect(snapped.text.toLowerCase().startsWith("hello")).toBe(false);
    assertWordsIntact(snapped.start, snapped.end, words);
    assertDuration(snapped.start, snapped.end, duration, target);
  });

  it("does not cut a word when the rough time falls in the middle of one", () => {
    const words = packed(0, Array.from({ length: 80 }, (_, i) => (i === 20 ? "INSIDE" : `w${i}`)), 0.5);
    const inside = words[20];
    const rough = round3((inside.start + inside.end) / 2);
    expect(rough).toBeGreaterThan(inside.start);
    expect(rough).toBeLessThan(inside.end);
    const snapped = snapToCompleteThought([asSegment(words)], rough, rough + 30, 80, 30);
    assertWordsIntact(snapped.start, snapped.end, words);
    assertDuration(snapped.start, snapped.end, 80, 30);
    // The cut sits on a word edge, not at the rough mid-word time.
    expect(Math.abs(snapped.start - rough)).toBeGreaterThan(0.05);
  });

  it("keeps a very long sentence inside the duration cap, on word edges", () => {
    const words = packed(0, Array.from({ length: 100 }, (_, i) => `w${i}`), 0.8);
    const target = 30;
    const duration = words[words.length - 1].end + 1;
    const snapped = snapToCompleteThought([asSegment(words)], 0, 70, duration, target);
    assertWordsIntact(snapped.start, snapped.end, words);
    assertDuration(snapped.start, snapped.end, duration, target);
    expect(snapped.end).toBeLessThan(words[words.length - 1].end - 1);
    const { max } = clipDurationLimits(target);
    expect(snapped.end - snapped.start).toBeLessThanOrEqual(max + 0.02);
  });

  it("uses a silence gap as a boundary when word timestamps hide the pause", () => {
    const words: TranscriptWord[] = [...packed(0, Array.from({ length: 20 }, (_, i) => `a${i}`), 0.5)];
    const beforeEnd = words[words.length - 1].end;
    // Whisper left only 50ms between words; ffmpeg still heard a silence.
    const after = word(round3(beforeEnd + 0.05), round3(beforeEnd + 0.45), "After");
    words.push(after);
    words.push(...packed(after.end, Array.from({ length: 60 }, (_, i) => `b${i}`), 0.5));
    const endWord = words[words.length - 1];
    const silenceResume = after.start;
    const silences = [{ start: round3(beforeEnd - 0.6), end: silenceResume }];
    const rough = round3(silenceResume + 3);
    const snapped = snapToCompleteThought([asSegment(words)], rough, rough + 30, endWord.end + 2, 30, silences);
    expect(snapped.start).toBeLessThanOrEqual(silenceResume);
    expect(snapped.start).toBeGreaterThan(beforeEnd);
    expect(snapped.text.toLowerCase().startsWith("after ")).toBe(true);
    assertWordsIntact(snapped.start, snapped.end, words);
    assertDuration(snapped.start, snapped.end, endWord.end + 2, 30);
  });

  it("stays inside the source when the clip is near the start", () => {
    const words: TranscriptWord[] = [word(0.2, 0.6, "Hello"), ...packed(0.6, Array.from({ length: 40 }, (_, i) => `w${i}`), 0.5)];
    words.push(word(words[words.length - 1].end, words[words.length - 1].end + 0.4, "there."));
    const duration = 100;
    const snapped = snapToCompleteThought([asSegment(words)], 0.45, 40, duration, 30);
    expect(snapped.start).toBeGreaterThanOrEqual(0);
    expect(snapped.start).toBeLessThanOrEqual(0.2);
    expect(snapped.text.toLowerCase().startsWith("hello ")).toBe(true);
    assertWordsIntact(snapped.start, snapped.end, words);
    assertDuration(snapped.start, snapped.end, duration, 30);
  });

  it("ends at the source instead of past it when the clip is near the end", () => {
    const words = packed(18, Array.from({ length: 24 }, (_, i) => (i === 23 ? "last." : `w${i}`)), 0.4);
    const duration = 28;
    expect(words[words.length - 1].end).toBeLessThanOrEqual(duration);
    const target = 30;
    const { min } = clipDurationLimits(target);
    const snapped = snapToCompleteThought([asSegment(words)], 22, duration, duration, target);
    assertWordsIntact(snapped.start, snapped.end, words);
    expect(snapped.end).toBeLessThanOrEqual(duration + 0.001);
    expect(snapped.start).toBeGreaterThanOrEqual(22 - BOUNDARY_TOLERANCE_SEC - 0.05);
    // Not enough media left for min length, and the earlier sentence is outside the window.
    expect(snapped.end - snapped.start).toBeLessThan(min);
    expect(snapped.end - snapped.start).toBeLessThanOrEqual(clipDurationLimits(target).max + 0.02);
    expect(snapped.text.toLowerCase()).toContain("last.");
  });

  it("still reaches a sentence end near the end of the source when one fits", () => {
    const words: TranscriptWord[] = [
      word(30, 30.4, "Earlier."),
      word(31, 31.4, "Begin"),
      ...packed(31.4, Array.from({ length: 40 }, (_, i) => `w${i}`), 0.5),
    ];
    const period = word(words[words.length - 1].end + 0.1, words[words.length - 1].end + 0.5, "end.");
    words.push(period);
    const duration = 60;
    expect(period.end).toBeLessThan(duration);
    const snapped = snapToCompleteThought([asSegment(words)], 34, 55, duration, 30);
    expect(snapped.start).toBeLessThanOrEqual(31);
    expect(snapped.start).toBeGreaterThan(30.4);
    expect(snapped.text.toLowerCase().startsWith("begin ")).toBe(true);
    expect(snapped.text.toLowerCase()).toContain("end.");
    expect(snapped.end).toBeLessThanOrEqual(duration);
    assertWordsIntact(snapped.start, snapped.end, words);
    assertDuration(snapped.start, snapped.end, duration, 30);
  });

  it("prefers a pause or sentence start over a higher-scoring mid-sentence cut", () => {
    // Whisper segment B starts mid-sentence on the hook word "what". The next
    // segment begins after a pause, outside B's snap window, so B stays mid-sentence.
    // That window overlaps the pause cut and used to win on the question score.
    const midStart = 16;
    const lead = packed(0, Array.from({ length: 40 }, () => "and"), 0.4);
    // Last lead word ends exactly when the mid-sentence segment begins (no pause).
    lead[lead.length - 1] = word(midStart - 0.4, midStart, "area");
    const mid = packed(midStart, ["internet", "because", "what", "was", "interesting", "at", "the", "time"], 0.45);
    const pauseAt = midStart + BOUNDARY_TOLERANCE_SEC + 0.8;
    const tail = packed(pauseAt, ["these", "companies", "operated", "openly"], 0.5);
    tail.push(...packed(tail[tail.length - 1].end, Array.from({ length: 50 }, (_, i) => `tail${i}`), 0.45));
    tail.push(word(tail[tail.length - 1].end, tail[tail.length - 1].end + 0.4, "stop."));
    const segments: TranscriptSegment[] = [asSegment(lead), asSegment(mid), asSegment(tail)];
    const duration = tail[tail.length - 1].end + 1;
    const clips = proposeClips(segments, duration, { targetSec: 30, maxClips: 1 });
    expect(clips.length).toBe(1);
    const spoken = clipText(segments, clips[0].start, clips[0].end).toLowerCase();
    expect(spoken.startsWith("these ") || spoken.startsWith("and ")).toBe(true);
    expect(spoken.startsWith("internet ") || spoken.startsWith("because ") || spoken.startsWith("what ")).toBe(false);
    assertWordsIntact(clips[0].start, clips[0].end, [...lead, ...mid, ...tail]);
    assertDuration(clips[0].start, clips[0].end, duration, 30);
  });

  it("proposeClips keeps every local clip on word edges and inside the duration cap", () => {
    const first = [
      ...packed(0, ["Here", "is", "a", "complete", "opening", "thought", "about", "mergers"], 0.45),
    ];
    first.push(word(first[first.length - 1].end, first[first.length - 1].end + 0.4, "today."));
    const secondStart = first[first.length - 1].end + 0.8;
    const second = [word(secondStart, secondStart + 0.4, "Later"), ...packed(secondStart + 0.4, Array.from({ length: 70 }, (_, i) => `p${i}`), 0.4)];
    second.push(word(second[second.length - 1].end, second[second.length - 1].end + 0.45, "done."));
    const words = [...first, ...second];
    const duration = words[words.length - 1].end + 1;
    const target = 30;
    const clips = proposeClips([asSegment(words)], duration, { targetSec: target, maxClips: 2 });
    expect(clips.length).toBeGreaterThan(0);
    for (const clip of clips) {
      assertWordsIntact(clip.start, clip.end, words);
      assertDuration(clip.start, clip.end, duration, target);
      const spoken = clipText([asSegment(words)], clip.start, clip.end).trim();
      expect(spoken.length).toBeGreaterThan(0);
      // The audible clip begins on a sentence, not on a leftover fragment.
      expect(spoken.split(" ")[0]?.replace(/[^\p{L}\p{N}]+/gu, "").length).toBeGreaterThan(0);
    }
  });
});
