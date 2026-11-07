import { describe, expect, it } from "vitest";
import { applyTranscriptPatch } from "./transcript";

const transcript = [
  {
    start: 172.95,
    end: 174.69,
    text: "dia menesahurku",
    words: [
      { start: 172.97, end: 173.2, word: "dia" },
      { start: 173.29, end: 174.6, word: "menesahurku" },
    ],
  },
  {
    start: 174.69,
    end: 176.95,
    text: "pake kornet dan juga chicken",
    words: [
      { start: 174.69, end: 175.2, word: "pake" },
      { start: 175.47, end: 175.9, word: "kornet" },
      { start: 176.11, end: 176.3, word: "dan" },
      { start: 176.33, end: 176.5, word: "juga" },
      { start: 176.57, end: 176.9, word: "chicken" },
    ],
  },
  { start: 180, end: 182, text: "tanpa kata berwaktu" },
];

describe("applyTranscriptPatch", () => {
  it("same word count: keeps timings, replaces words and text", () => {
    const out = applyTranscriptPatch(transcript, [{ index: 1, text: "pake kornet dan juga ayam" }]);
    expect(out[1].text).toBe("pake kornet dan juga ayam");
    expect(out[1].words?.map((w) => w.word)).toEqual(["pake", "kornet", "dan", "juga", "ayam"]);
    // Original timings preserved.
    expect(out[1].words?.[0].start).toBeCloseTo(174.69);
    expect(out[1].words?.[1].start).toBeCloseTo(175.47);
    expect(out[1].words?.[4].end).toBeCloseTo(176.9);
  });

  it("different word count: re-spreads timings across the segment", () => {
    const out = applyTranscriptPatch(transcript, [{ index: 0, text: "dia nemenin sahurku" }]);
    expect(out[0].text).toBe("dia nemenin sahurku");
    expect(out[0].words?.map((w) => w.word)).toEqual(["dia", "nemenin", "sahurku"]);
    // Span 172.95–174.69 (1.74s) split evenly into 3.
    expect(out[0].words?.[0].start).toBeCloseTo(172.95);
    expect(out[0].words?.[1].start).toBeCloseTo(173.53);
    expect(out[0].words?.[2].end).toBeCloseTo(174.69);
  });

  it("wordless segment: replaces text and gains evenly-spread words", () => {
    const out = applyTranscriptPatch(transcript, [{ index: 2, text: "tanpa kata" }]);
    expect(out[2].text).toBe("tanpa kata");
    // No old timings to keep, so words are spread across the 180–182s span.
    expect(out[2].words?.map((w) => w.word)).toEqual(["tanpa", "kata"]);
    expect(out[2].words?.[0].start).toBeCloseTo(180);
    expect(out[2].words?.[1].end).toBeCloseTo(182);
  });

  it("ignores out-of-range indexes and empty texts", () => {
    const out = applyTranscriptPatch(transcript, [
      { index: 99, text: "x" },
      { index: 0, text: "   " },
    ]);
    expect(out).toEqual(transcript);
  });

  it("does not mutate the input", () => {
    const before = JSON.stringify(transcript);
    applyTranscriptPatch(transcript, [{ index: 0, text: "dia nemenin sahurku" }]);
    expect(JSON.stringify(transcript)).toBe(before);
  });
});
