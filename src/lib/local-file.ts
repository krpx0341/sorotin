import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function downloadsDir() {
  return process.env.XDG_DOWNLOAD_DIR || path.join(/* turbopackIgnore: true */ os.homedir(), "Downloads");
}

export function safeFileName(name: string) {
  const cleaned = name.replace(/[/\\?%*:|"<>]/g, "-").replace(/\s+/g, " ").trim() || "clip";
  return cleaned.toLowerCase().endsWith(".mp4") ? cleaned : `${cleaned}.mp4`;
}

export function uniqueDest(dir: string, filename: string) {
  const ext = path.extname(filename) || ".mp4";
  const stem = filename.slice(0, filename.length - ext.length) || "clip";
  let dest = path.join(/* turbopackIgnore: true */ dir, filename);
  let i = 1;
  while (fs.existsSync(/* turbopackIgnore: true */ dest)) {
    dest = path.join(/* turbopackIgnore: true */ dir, `${stem}-${i}${ext}`);
    i += 1;
  }
  return dest;
}

export function openLocal(abs: string) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  const child = spawn(cmd, [abs], { detached: true, stdio: "ignore" });
  child.unref();
}
