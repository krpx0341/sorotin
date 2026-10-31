import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_WHISPER_MODEL, whisperModel } from "./whisper";

const prev = process.env.PERSONAL_CLIPPER_WHISPER_MODEL;

afterEach(() => {
  if (prev === undefined) delete process.env.PERSONAL_CLIPPER_WHISPER_MODEL;
  else process.env.PERSONAL_CLIPPER_WHISPER_MODEL = prev;
});

describe("whisperModel", () => {
  it("defaults to large-v3-turbo for local desktop quality", () => {
    delete process.env.PERSONAL_CLIPPER_WHISPER_MODEL;
    expect(DEFAULT_WHISPER_MODEL).toBe("large-v3-turbo");
    expect(whisperModel()).toBe("large-v3-turbo");
  });

  it("honors PERSONAL_CLIPPER_WHISPER_MODEL", () => {
    process.env.PERSONAL_CLIPPER_WHISPER_MODEL = "small";
    expect(whisperModel()).toBe("small");
  });
});
