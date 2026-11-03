import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";
import { JobAbortedError } from "./jobs";
import { faceCropCenter, settleFaceTrackError } from "./pipeline";

const spawnMock = vi.mocked(spawn);

function fakeChild(code: number | null, stdout: string, stderr: string) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: (signal?: string) => void;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  setTimeout(() => {
    if (stdout) child.stdout.emit("data", Buffer.from(stdout));
    if (stderr) child.stderr.emit("data", Buffer.from(stderr));
    child.emit("close", code, null);
  }, 0);
  return child;
}

afterEach(() => {
  spawnMock.mockReset();
  vi.restoreAllMocks();
});

describe("face_track failure falls back to a center crop", () => {
  it("logs a warning and returns a center crop when face_track exits non-zero", async () => {
    spawnMock.mockImplementation(
      () =>
        fakeChild(
          1,
          "",
          "face_track: OpenCV 5.0.0 has no cv2.FaceDetectorYN, so faces cannot be detected. pip install 'opencv-python-headless>=4.8,<6'\n",
        ) as unknown as ReturnType<typeof spawn>,
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const face = await faceCropCenter("/tmp/clip.mp4", 0, 10, { w: 1080, h: 1920, allowDual: true });
    expect(face.cx).toBe(0.5);
    expect(face.cy).toBe(0.38);
    expect(face.confidence).toBe(0);
    expect(face.segments).toEqual([]);
    expect(face.speakerCount).toBe(1);
    expect(warn).toHaveBeenCalled();
    const text = warn.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(text).toMatch(/\[face\]/);
    expect(text).toMatch(/crop tengah/);
    expect(text).toMatch(/FaceDetectorYN/);
    expect(text).toMatch(/opencv-python-headless/);
  });

  it("does not warn when face_track returns a plan", async () => {
    const plan = {
      cx: 0.62,
      cy: 0.4,
      confidence: 0.9,
      face_w: 0.2,
      face_h: 0.3,
      faces: [{ cx: 0.62, cy: 0.4, face_w: 0.2, face_h: 0.3 }],
      speaker_count: 1,
      segments: [
        {
          start: 0,
          end: 10,
          layout: "single",
          crops: [{ x: 100, y: 0, w: 404, h: 720 }],
          face_boxes: [],
        },
      ],
      cover: { t: 2, segment: 0, score: 1 },
      trim_start: 0,
      trim_end: 0,
    };
    spawnMock.mockImplementation(
      () => fakeChild(0, JSON.stringify(plan), "") as unknown as ReturnType<typeof spawn>,
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const face = await faceCropCenter("/tmp/clip.mp4", 0, 10, { w: 1080, h: 1920, allowDual: true });
    expect(warn).not.toHaveBeenCalled();
    expect(face.cx).toBeCloseTo(0.62);
    expect(face.segments).toHaveLength(1);
    expect(face.segments[0].layout).toBe("single");
  });

  it("still aborts the render when the job is stopped", () => {
    expect(() => settleFaceTrackError(new JobAbortedError("studio-1"))).toThrow(JobAbortedError);
  });
});
