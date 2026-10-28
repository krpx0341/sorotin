import { proposeClips } from "@/lib/pipeline";
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
});
