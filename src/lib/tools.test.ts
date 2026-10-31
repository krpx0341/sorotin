import { afterEach, describe, expect, it } from "vitest";
import { captionFontDir, clipperPython, clipperScript, coverFont, pythonChildEnv } from "./tools";

const saved = new Map<string, string | undefined>();

afterEach(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  saved.clear();
});

function setEnv(k: string, v: string) {
  if (!saved.has(k)) saved.set(k, process.env[k]);
  process.env[k] = v;
}

describe("bundled tool paths", () => {
  it("prefers env overrides", () => {
    setEnv("PERSONAL_CLIPPER_PYTHON", "/opt/sorotin/python");
    setEnv("PERSONAL_CLIPPER_FONT_DIR", "/opt/sorotin/fonts");
    setEnv("PERSONAL_CLIPPER_COVER_FONT", "/opt/sorotin/fonts/Cover.ttf");
    setEnv("PERSONAL_CLIPPER_SCRIPTS_DIR", "/opt/sorotin/scripts");
    expect(clipperPython()).toBe("/opt/sorotin/python");
    expect(captionFontDir()).toBe("/opt/sorotin/fonts");
    expect(coverFont()).toBe("/opt/sorotin/fonts/Cover.ttf");
    expect(clipperScript("transcribe.py")).toBe("/opt/sorotin/scripts/transcribe.py");
    expect(pythonChildEnv()).toEqual({});
  });
});
