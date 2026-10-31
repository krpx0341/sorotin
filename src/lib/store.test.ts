import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { publicMediaUrl, resolvePublicFile } from "./store";

const prev = process.env.PERSONAL_CLIPPER_DATA_DIR;

afterEach(() => {
  if (prev === undefined) delete process.env.PERSONAL_CLIPPER_DATA_DIR;
  else process.env.PERSONAL_CLIPPER_DATA_DIR = prev;
});

describe("publicMediaUrl / resolvePublicFile", () => {
  it("serves files from PERSONAL_CLIPPER_DATA_DIR, not cwd", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sorotin-data-"));
    process.env.PERSONAL_CLIPPER_DATA_DIR = dir;
    const abs = path.join(dir, "studios", "abc", "clips", "c1", "cover.jpg");
    const url = publicMediaUrl(abs);
    expect(url).toBe("/api/files?path=data%2Fstudios%2Fabc%2Fclips%2Fc1%2Fcover.jpg");
    expect(resolvePublicFile("data/studios/abc/clips/c1/cover.jpg")).toBe(abs);
    expect(resolvePublicFile("..%2F.local/share/x.jpg")).toBeNull();
    expect(resolvePublicFile("../.local/share/x.jpg")).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
