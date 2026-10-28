import { proposeClips, windowsFromSilence, windowsFromTranscript } from "@/lib/clipper";
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
        { start: 5, end: 20, text: "cara viral tips penting sekali" },
        { start: 40, end: 70, text: "bagian biasa saja tanpa hook" },
      ],
      90,
      30,
    );
    expect(segments.length).toBeGreaterThan(0);
    const fromSilence = windowsFromSilence([{ start: 20, end: 22 }], 90, 30);
    expect(fromSilence.length).toBeGreaterThan(0);
  });
});
