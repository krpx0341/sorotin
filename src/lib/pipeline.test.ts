import { proposeClips, snapToCompleteThought, windowsFromSilence, windowsFromTranscript } from "@/lib/clipper";
import { buildAssCaptions, wordsForClip } from "@/lib/captions";
import type { TranscriptSegment } from "@/lib/types";
import { describe, expect, it } from "vitest";

describe("proposeClips", () => {
  it("picks non-overlapping high-density windows", () => {
    const segments: TranscriptSegment[] = [];
    for (let i = 0; i < 40; i++) {
      segments.push({
        start: i * 5,
        end: i * 5 + 4,
        text: i % 7 === 0 ? "Ini tips penting banget!" : `kata biasa ${i}`,
      });
    }
    const clips = proposeClips(segments, 200, { targetSec: 30, maxClips: 5 });
    expect(clips.length).toBeGreaterThan(0);
    expect(clips.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < clips.length; i++) {
      expect(clips[i].start).toBeGreaterThanOrEqual(clips[i - 1].start);
    }
    expect(clips.some((c) => c.grades)).toBe(true);
  });

  it("falls back when transcript empty", () => {
    const clips = proposeClips([], 120, { targetSec: 40, maxClips: 3 });
    expect(clips.length).toBeGreaterThan(0);
  });

  it("uses silence islands when speech empty", () => {
    const clips = proposeClips([], 100, {
      targetSec: 30,
      maxClips: 4,
      silences: [
        { start: 10, end: 12 },
        { start: 45, end: 47 },
        { start: 80, end: 82 },
      ],
    });
    expect(clips.length).toBeGreaterThan(0);
    expect(clips.some((c) => c.reason.includes("speech island") || c.reason.includes("silence"))).toBe(
      true,
    );
  });

  it("builds transcript and silence windows", () => {
    const segments = windowsFromTranscript(
      [
        { start: 0, end: 5, text: "halo" },
        { start: 5, end: 20, text: "cara viral tips penting sekali." },
        { start: 40, end: 70, text: "bagian biasa saja tanpa hook" },
      ],
      90,
      30,
    );
    expect(segments.length).toBeGreaterThan(0);
    const fromSilence = windowsFromSilence([{ start: 20, end: 22 }], 90, 30);
    expect(fromSilence.length).toBeGreaterThan(0);
  });

  it("snaps to complete thoughts", () => {
    const snapped = snapToCompleteThought(
      [
        { start: 0, end: 4, text: "awal cerita" },
        { start: 4, end: 12, text: "tips diet turun 10 kg." },
        { start: 12, end: 20, text: "lanjutan lain" },
      ],
      1,
      18,
      40,
      15,
    );
    expect(snapped.end).toBeGreaterThan(snapped.start);
    expect(snapped.text.toLowerCase()).toContain("tips");
  });
});

describe("captions", () => {
  it("builds timed ASS with keyword highlights", () => {
    const words = wordsForClip(
      [
        {
          start: 10,
          end: 14,
          text: "gue nih kalau diet",
          words: [
            { start: 10, end: 10.4, word: "gue" },
            { start: 10.4, end: 10.9, word: "nih" },
            { start: 10.9, end: 11.4, word: "kalau" },
            { start: 11.4, end: 12.2, word: "diet" },
          ],
        },
      ],
      10,
      14,
    );
    expect(words.length).toBe(4);
    const ass = buildAssCaptions({ words, playResX: 1080, playResY: 1920, clipStart: 10 });
    expect(ass).toContain("Dialogue:");
    expect(ass).toMatch(/DIET/i);
    expect(ass).toMatch(/&H0000(FF00|E5FF|FFD0|C8FF|F5FF|8CFF)&/);
  });
});

describe("splitCoverTitle", () => {
  it("keeps every word of a long title (no silent drop)", async () => {
    const { splitCoverTitle } = await import("./pipeline");
    const lines = splitCoverTitle("Kenapa Perceraian H3H3 Sangat Mengejutkan", 20);
    expect(lines.join(" ")).toBe("Kenapa Perceraian H3H3 Sangat Mengejutkan");
    expect(lines.every((l) => l.length <= 20)).toBe(true);
  });
  it("ellipsizes only past maxLines", async () => {
    const { splitCoverTitle } = await import("./pipeline");
    const lines = splitCoverTitle("aaaa bbbb cccc dddd eeee ffff gggg hhhh", 9, 2);
    expect(lines).toEqual(["aaaa bbbb", "cccc dddd…"]);
  });
});

describe("clip boundaries + titles (no-punctuation transcripts)", () => {
  it("never picks overlapping clips", async () => {
    const { overlaps } = await import("@/lib/clipper");
    expect(overlaps({ start: 2183.6, end: 2223.8 }, { start: 2209.4, end: 2248.9 })).toBe(true);
    expect(overlaps({ start: 0, end: 40 }, { start: 39.5, end: 80 })).toBe(false);
  });
  it("prefers ending after a pause, not on a dangling connector", async () => {
    const { snapToCompleteThought } = await import("@/lib/clipper");
    const segs: TranscriptSegment[] = [];
    let t = 0;
    for (let i = 0; i < 60; i++) {
      // every 6th segment is followed by a 1.2s pause; others run on with "karena"/"dan"
      const text = i % 6 === 5 ? `cerita selesai ${i}` : i % 2 ? `lanjut ${i} karena` : `kalimat ${i} dan`;
      segs.push({ start: t, end: t + 1.5, text });
      t += 1.5 + (i % 6 === 5 ? 1.2 : 0.05);
    }
    const r = snapToCompleteThought(segs, 0, 40, 200, 30);
    const last = segs.filter((s) => s.end <= r.end + 0.01).pop()!;
    expect(last.text).toMatch(/^cerita selesai/);
    expect(r.end - r.start).toBeGreaterThanOrEqual(16);
  });
  it("starts after a finished thought instead of on a connector", async () => {
    const { snapToCompleteThought } = await import("@/lib/clipper");
    const segs: TranscriptSegment[] = [
      { start: 0, end: 3, text: "jadi gitu ceritanya." },
      { start: 4, end: 6, text: "Kenapa kamu pergi?" },
      { start: 6.05, end: 8, text: "karena aku takut" },
      { start: 8.05, end: 40, text: "panjang sekali ceritanya." },
    ];
    const r = snapToCompleteThought(segs, 5.9, 40, 60, 34);
    expect(r.start).toBeLessThanOrEqual(4);
  });
  it("builds a short sentence-case hook title, preferring questions", async () => {
    const { hookTitleFromSegments } = await import("@/lib/clipper");
    const title = hookTitleFromSegments(
      [
        { start: 0, end: 2, text: "oke jadi" },
        { start: 2, end: 5, text: "kapan kamu mulai berani cerita di sosmed" },
        { start: 5, end: 9, text: "aku sebenernya udah lama mikir" },
      ],
      "Clip 1",
    );
    expect(title).toBe("Kapan kamu mulai berani cerita di sosmed?");
    expect(title.length).toBeLessThanOrEqual(53);
  });
});

describe("trailing-off endings and sentence titles", () => {
  it("does not end a clip on a Whisper '...' trail-off", async () => {
    const { endQuality } = await import("@/lib/clipper");
    const segs: TranscriptSegment[] = [
      { start: 0, end: 2, text: "Oke, terus kenapa sampai akhirnya sih..." },
      { start: 3, end: 4, text: "...mantan..." },
      { start: 5, end: 7, text: "Itu ceritanya." },
      { start: 8.5, end: 9, text: "Iya." },
    ];
    expect(endQuality(segs, 0)).toBeLessThan(endQuality(segs, 2));
  });
  it("title keeps whole sentences", async () => {
    const { hookTitleFromSegments } = await import("@/lib/clipper");
    const t = hookTitleFromSegments(
      [{ start: 0, end: 4, text: "Kamu rasa takut yang mana dulu? Takut ya, takutnya gitu" }],
      "Clip",
    );
    expect(t).toBe("Kamu rasa takut yang mana dulu?");
  });
});
