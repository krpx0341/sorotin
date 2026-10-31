import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "clipper-test-"));
process.env.PERSONAL_CLIPPER_DATA_DIR = tmp;

describe("jobs + stale studios", () => {
  it("marks a busy studio without a live job as interrupted, keeps live ones busy", async () => {
    const store = await import("./store");
    const jobs = await import("./jobs");
    const base = {
      title: "t",
      source: "upload" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      skills: store.mergeSkills(),
      clips: [],
      exportAspect: "9:16" as const,
      progress: { pct: 48, message: "Whisper transcribe…" },
    };
    store.saveStudio({ ...base, id: "stale-1", status: "transcribing" });
    store.saveStudio({ ...base, id: "live-1", status: "rendering" });
    const signal = jobs.beginJob("live-1");
    expect(store.loadStudio("stale-1")?.status).toBe("error");
    expect(store.loadStudio("stale-1")?.error).toBe(store.INTERRUPTED_MESSAGE);
    expect(store.loadStudio("live-1")?.status).toBe("rendering");
    jobs.endJob("live-1", signal);
    expect(store.loadStudio("live-1")?.status).toBe("error");
  });

  it("stopJob kills tracked child processes", async () => {
    const jobs = await import("./jobs");
    jobs.beginJob("stop-1");
    const child = spawn("sleep", ["30"]);
    jobs.trackChild("stop-1", child);
    const exited = new Promise<string | null>((r) => child.on("exit", (_c, sig) => r(sig)));
    expect(jobs.hasActiveJob("stop-1")).toBe(true);
    jobs.stopJob("stop-1");
    expect(jobs.hasActiveJob("stop-1")).toBe(false);
    expect(await exited).toBe("SIGTERM");
  });
});

describe("download errors + local files", () => {
  it("maps yt-dlp failures to actionable messages", async () => {
    const { friendlyDownloadError } = await import("./pipeline");
    expect(friendlyDownloadError("ERROR: [youtube] x: Sign in to confirm you're not a bot")).toMatch(/Upload/);
    expect(friendlyDownloadError("ERROR: [youtube] x: Private video")).toMatch(/private/i);
    expect(friendlyDownloadError("yt-dlp dihentikan: tidak ada progress selama 180s.")).toMatch(/macet/);
    expect(friendlyDownloadError("ERROR: something odd happened")).toMatch(/^Download gagal: something odd/);
  });

  it("validates local video paths", async () => {
    const { resolveLocalVideo } = await import("./pipeline");
    const vid = path.join(tmp, "my video.mp4");
    fs.writeFileSync(vid, Buffer.alloc(4096));
    const ok = resolveLocalVideo(`  ${vid} `);
    expect(ok).toEqual({ ok: true, absPath: vid, title: "my video" });
    expect(resolveLocalVideo("relative/x.mp4").ok).toBe(false);
    expect(resolveLocalVideo(path.join(tmp, "nope.mp4")).ok).toBe(false);
    const txt = path.join(tmp, "notes.txt");
    fs.writeFileSync(txt, "x".repeat(2000));
    expect(resolveLocalVideo(txt).ok).toBe(false);
  });
});
