import { describe, expect, it } from "vitest";
import { buildAssCaptions, captionBandHeight, splitByPlacement } from "./captions";
import {
  buildReframeGraph,
  captionPlacements,
  parseSegments,
  pickCaptionBottom,
  segmentAt,
  type FaceBoxOut,
} from "./reframe";
import { pickHookTop } from "./reframe";

const crop = (x: number) => ({ x, y: 0, w: 404, h: 720 });

describe("parseSegments", () => {
  it("snaps segments to be contiguous from 0 and downgrades dual when not allowed", () => {
    const segs = parseSegments(
      [
        { start: 0.1, end: 1.8, layout: "single", crops: [crop(10)] },
        { start: 1.9, end: 6, layout: "dual", crops: [crop(0), crop(400)] },
      ],
      false,
    );
    expect(segs.map((s) => [s.start, s.end, s.layout])).toEqual([
      [0, 1.9, "single"],
      [1.9, 6, "single"],
    ]);
    expect(segs[1].crops).toHaveLength(1);
  });
  it("rejects plans with missing crops", () => {
    expect(parseSegments([{ start: 0, end: 3, layout: "single", crops: [] }], true)).toEqual([]);
    expect(parseSegments(null, true)).toEqual([]);
  });
});

describe("buildReframeGraph", () => {
  it("single segment is a plain crop/scale chain", () => {
    const g = buildReframeGraph([{ start: 0, end: 5, layout: "single", crops: [crop(486)] }], 1080, 1920);
    expect(g).toBe("[0:v]crop=404:720:486:0,scale=1080:1920:flags=lanczos,setsar=1[base]");
  });
  it("mixed single/dual segments trim+concat with open-ended first/last trims", () => {
    const g = buildReframeGraph(
      [
        { start: 0, end: 1.8, layout: "single", crops: [crop(486)] },
        { start: 1.8, end: 6.433, layout: "dual", crops: [crop(200), crop(500)] },
        { start: 6.433, end: 20, layout: "single", crops: [crop(490)] },
      ],
      1080,
      1920,
    );
    expect(g).toContain("[0:v]split=3[in0][in1][in2]");
    expect(g).toContain("[in0]trim=end=1.8,setpts=PTS-STARTPTS[tr0]");
    expect(g).toContain("[in1]trim=start=1.8:end=6.433,setpts=PTS-STARTPTS[tr1]");
    expect(g).toContain("[in2]trim=start=6.433,setpts=PTS-STARTPTS[tr2]");
    expect(g).toContain("scale=1080:960:flags=lanczos");
    expect(g).toContain("[s1t][s1u]vstack=inputs=2[p1]");
    expect(g.endsWith("[p0][p1][p2]concat=n=3:v=1:a=0[base]")).toBe(true);
  });
  it("segmentAt finds the covering segment", () => {
    const segs = parseSegments(
      [
        { start: 0, end: 2, layout: "single", crops: [crop(0)] },
        { start: 2, end: 5, layout: "single", crops: [crop(0)] },
      ],
      true,
    );
    expect(segmentAt(segs, 0)).toBe(0);
    expect(segmentAt(segs, 3.9)).toBe(1);
    expect(segmentAt(segs, 99)).toBe(1);
  });
});


const box = (x0: number, y0: number, x1: number, y1: number, coreY0: number, coreY1: number): FaceBoxOut => ({
  x0,
  y0,
  x1,
  y1,
  coreY0,
  coreY1,
});

describe("caption placement", () => {
  const bandH = captionBandHeight(1920, 2);
  it("split shot: band lands between the faces and never touches a brow→chin box", () => {
    const faces = [box(0.05, 0, 0.47, 0.342, 0.08, 0.32), box(0.38, 0.5, 0.81, 0.843, 0.6, 0.82)];
    const bottom = pickCaptionBottom(faces, { bandH, preferBottom: 0.5 });
    const top = bottom - bandH;
    for (const f of faces) {
      expect(Math.min(bottom, f.coreY1) - Math.max(top, f.coreY0)).toBeLessThanOrEqual(0);
    }
    expect(bottom).toBeGreaterThan(0.4);
    expect(bottom).toBeLessThanOrEqual(0.6);
  });
  it("moves below the lower face when the seam is covered", () => {
    const faces = [box(0.1, 0.05, 0.9, 0.6, 0.15, 0.58), box(0.1, 0.55, 0.9, 0.7, 0.58, 0.68)];
    const bottom = pickCaptionBottom(faces, { bandH, preferBottom: 0.5 });
    expect(bottom - bandH).toBeGreaterThanOrEqual(0.68 - 1e-9);
  });
  it("single shots keep the default margin; dual shots get their own", () => {
    const p = captionPlacements(
      [
        { start: 0, end: 2, layout: "single", crops: [crop(0)], faceBoxes: [box(0.2, 0.1, 0.8, 0.6, 0.15, 0.55)] },
        {
          start: 2,
          end: 6,
          layout: "dual",
          crops: [crop(0), crop(400)],
          faceBoxes: [box(0.05, 0, 0.47, 0.342, 0.08, 0.32), box(0.38, 0.5, 0.81, 0.843, 0.6, 0.82)],
        },
      ],
      { playResY: 1920, defaultMarginV: 461, bandH },
    );
    expect(p[0].marginV).toBe(461);
    expect(p[1].marginV).not.toBe(461);
    expect(p[1]).toMatchObject({ start: 2, end: 6 });
  });
  it("splits caption events that cross a shot boundary", () => {
    expect(
      splitByPlacement(1.5, 2.5, [
        { start: 0, end: 2, marginV: 461 },
        { start: 2, end: 6, marginV: 900 },
      ]),
    ).toEqual([
      { start: 1.5, end: 2, marginV: 461 },
      { start: 2, end: 2.5, marginV: 900 },
    ]);
    const ass = buildAssCaptions({
      words: [{ start: 11.5, end: 12.5, word: "halo" }],
      playResX: 1080,
      playResY: 1920,
      clipStart: 10,
      placements: [
        { start: 0, end: 2, marginV: 461 },
        { start: 2, end: 6, marginV: 900 },
      ],
    });
    expect(ass).toContain("Dialogue: 0,0:00:01.50,0:00:02.00,Caption,,0,0,461,,");
    expect(ass).toContain("Dialogue: 0,0:00:02.00,0:00:02.50,Caption,,0,0,900,,");
  });
});

describe("pickHookTop", () => {
  const seg = (faceY0: number, faceY1: number, layout: "single" | "dual" = "single") =>
    ({
      start: 0,
      end: 10,
      layout,
      crops: [],
      faces: 1,
      faceBoxes: [{ x0: 0.3, x1: 0.7, y0: faceY0, y1: faceY1, coreY0: faceY0 + 0.02, coreY1: faceY1 - 0.02 }],
    }) as unknown as import("./reframe").ReframeSegment;
  it("stays at the top when the face is lower", () => {
    expect(pickHookTop([seg(0.3, 0.5)], { cardH: 0.12, cardW: 0.88, hookSec: 3.5 })).toBeCloseTo(0.085, 2);
  });
  it("moves below a face that sits at the top", () => {
    const top = pickHookTop([seg(0.08, 0.3)], { cardH: 0.12, cardW: 0.88, hookSec: 3.5 });
    expect(top).toBeGreaterThanOrEqual(0.28);
    expect(top + 0.12).toBeLessThanOrEqual(0.62 + 1e-6);
  });
  it("defaults to the top without face data", () => {
    expect(pickHookTop([], { cardH: 0.12, cardW: 0.88, hookSec: 3.5 })).toBe(0.085);
  });
});
