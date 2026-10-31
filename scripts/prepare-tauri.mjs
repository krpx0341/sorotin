import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const standalone = path.join(root, ".next/standalone");
const dest = path.join(root, "src-tauri/resources/server");

if (!fs.existsSync(path.join(standalone, "server.js"))) {
  console.error("missing .next/standalone/server.js — run pnpm build first");
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });

if (process.platform === "win32") {
  fs.cpSync(standalone, dest, { recursive: true });
} else {
  // Keep pnpm's relative .pnpm symlinks (do not dereference). Node's fs.cpSync
  // rewrites them to absolute paths and the AppImage then misses `next`.
  const copied = spawnSync("cp", ["-a", `${standalone}/.`, dest], { stdio: "inherit" });
  if (copied.status !== 0) {
    console.error("cp -a standalone failed");
    process.exit(1);
  }
}

const staticSrc = path.join(root, ".next/static");
if (fs.existsSync(staticSrc)) {
  fs.cpSync(staticSrc, path.join(dest, ".next/static"), { recursive: true });
}
const publicSrc = path.join(root, "public");
if (fs.existsSync(publicSrc)) {
  fs.cpSync(publicSrc, path.join(dest, "public"), { recursive: true });
}
const scriptsSrc = path.join(root, "scripts");
if (fs.existsSync(scriptsSrc)) {
  fs.cpSync(scriptsSrc, path.join(dest, "scripts"), {
    recursive: true,
    filter: (p) => !p.endsWith(".mjs"),
  });
}
console.log("copied Next standalone → src-tauri/resources/server");
