import { describe, expect, it } from "vitest";
import { buildAssCaptions } from "./captions";

const words = [
  { start: 0, end: 0.4, word: "gue" },
  { start: 0.4, end: 0.8, word: "banget" },
  { start: 0.8, end: 1.2, word: "kan" },
];

describe("buildAssCaptions", () => {
  it('hijau: active word is green, no yellow/orange anywhere', () => {
    const ass = buildAssCaptions({ words, playResX: 1080, playResY: 1920, clipStart: 0, style: "hijau" });
    expect(ass).toContain("&H0035F51F&"); // #1FF535 in ASS BBGGRR
    expect(ass).not.toContain("&H0000F5FF&"); // yellow
    expect(ass).not.toContain("&H00008CFF&"); // orange-hot
  });

  it('classic: active word is yellow, emphasis word is orange', () => {
    const ass = buildAssCaptions({ words, playResX: 1080, playResY: 1920, clipStart: 0 });
    expect(ass).toContain("&H0000F5FF&"); // "gue" / "kan" active
    expect(ass).toContain("&H00008CFF&"); // "banget" matches EMPHASIS_RE
  });

  it('hijau: caption band stays at the default margin (placements ignored)', () => {
    const placements = [{ start: 0, end: 1.2, marginV: 900 }];
    const ass = buildAssCaptions({
      words,
      playResX: 1080,
      playResY: 1920,
      clipStart: 0,
      style: "hijau",
      placements,
    });
    // Every Dialogue margin field must be 0 (style default), never the 900 override.
    const margins = [...ass.matchAll(/^Dialogue: [^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,(\d+),/gm)].map((m) => m[1]);
    expect(margins.length).toBeGreaterThan(0);
    expect(margins.every((m) => m === "0")).toBe(true);
  });
});
