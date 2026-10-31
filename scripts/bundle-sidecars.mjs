#!/usr/bin/env node
/**
 * Download portable Node, ffmpeg, yt-dlp, CPython, and fonts into
 * src-tauri/resources for the current OS/arch desktop bundle.
 */
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  cpSync,
  chmodSync,
  rmSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const res = path.join(root, "src-tauri", "resources");
const bin = path.join(res, "bin");
const pythonDir = path.join(res, "python");
const fonts = path.join(res, "fonts");
const cache = path.join(res, ".cache");
const force = process.argv.includes("--force");
const win = process.platform === "win32";
const mac = process.platform === "darwin";
const arch = process.arch; // x64 | arm64

mkdirSync(bin, { recursive: true });
mkdirSync(fonts, { recursive: true });
mkdirSync(cache, { recursive: true });

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.status})`);
}

function chmod755(file) {
  if (!win) chmodSync(file, 0o755);
}

async function download(url, dest) {
  console.log("get", url);
  const r = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "sorotin-bundle" },
  });
  if (!r.ok || !r.body) throw new Error(`${url} → ${r.status}`);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(dest));
}

async function githubAsset(repo, pred) {
  const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { "User-Agent": "sorotin-bundle", Accept: "application/vnd.github+json" },
  });
  if (!r.ok) throw new Error(`${repo} releases ${r.status}`);
  const j = await r.json();
  const asset = (j.assets || []).find((a) => pred(a.name));
  if (!asset) throw new Error(`no asset in ${repo} @ ${j.tag_name}`);
  return asset.browser_download_url;
}

function have(file) {
  return existsSync(file) && !force;
}

function findNamed(dir, names) {
  const want = new Set(names);
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let ents;
    try {
      ents = readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of ents) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else if (want.has(ent.name)) return p;
    }
  }
  return null;
}

function extractArchive(archive, dest) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  run("tar", ["-xf", archive, "-C", dest]);
}

function nodeDist() {
  const ver = process.version.startsWith("v") ? process.version : `v${process.version}`;
  if (win) return { ver, name: `node-${ver}-win-x64`, ext: "zip", file: "node.exe" };
  if (mac && arch === "arm64") return { ver, name: `node-${ver}-darwin-arm64`, ext: "tar.gz", file: "node" };
  if (mac) return { ver, name: `node-${ver}-darwin-x64`, ext: "tar.gz", file: "node" };
  if (arch === "arm64") return { ver, name: `node-${ver}-linux-arm64`, ext: "tar.xz", file: "node" };
  return { ver, name: `node-${ver}-linux-x64`, ext: "tar.xz", file: "node" };
}

async function bundleNode() {
  const dest = path.join(bin, win ? "node.exe" : "node");
  if (have(dest)) return console.log("skip node");
  const spec = nodeDist();
  const archive = path.join(cache, `${spec.name}.${spec.ext}`);
  if (!existsSync(archive) || force) {
    await download(`https://nodejs.org/dist/${spec.ver}/${spec.name}.${spec.ext}`, archive);
  }
  const tmp = path.join(cache, "node-extract");
  extractArchive(archive, tmp);
  const found = findNamed(tmp, [spec.file]);
  if (!found) throw new Error(`node binary missing in ${spec.name}`);
  cpSync(found, dest);
  chmod755(dest);
  console.log("node", dest);
}

function ffmpegArchive() {
  if (win) {
    return {
      url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
      file: "ffmpeg-win64-gpl.zip",
      bins: ["ffmpeg.exe", "ffprobe.exe"],
    };
  }
  if (mac) {
    const cpu = arch === "arm64" ? "arm64" : "amd64";
    return {
      url: `https://ffmpeg.martin-riedl.de/redirect/latest/macos/${cpu}/release/ffmpeg.zip`,
      probe: `https://ffmpeg.martin-riedl.de/redirect/latest/macos/${cpu}/release/ffprobe.zip`,
      file: `ffmpeg-macos-${cpu}.zip`,
      probeFile: `ffprobe-macos-${cpu}.zip`,
      bins: ["ffmpeg", "ffprobe"],
      split: true,
    };
  }
  const linux = arch === "arm64" ? "linuxarm64" : "linux64";
  return {
    url: `https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-${linux}-gpl.tar.xz`,
    file: `ffmpeg-${linux}-gpl.tar.xz`,
    bins: ["ffmpeg", "ffprobe"],
  };
}

async function bundleFfmpeg() {
  const names = win ? ["ffmpeg.exe", "ffprobe.exe"] : ["ffmpeg", "ffprobe"];
  const dests = names.map((n) => path.join(bin, n));
  if (dests.every(have)) return console.log("skip ffmpeg");
  const spec = ffmpegArchive();
  if (spec.split) {
    const ffTar = path.join(cache, spec.file);
    const prTar = path.join(cache, spec.probeFile);
    if (!existsSync(ffTar) || force) await download(spec.url, ffTar);
    if (!existsSync(prTar) || force) await download(spec.probe, prTar);
    const tmpFf = path.join(cache, "ffmpeg-extract");
    const tmpPr = path.join(cache, "ffprobe-extract");
    extractArchive(ffTar, tmpFf);
    extractArchive(prTar, tmpPr);
    const ff = findNamed(tmpFf, ["ffmpeg", "ffmpeg.exe"]);
    const pr = findNamed(tmpPr, ["ffprobe", "ffprobe.exe"]);
    if (!ff || !pr) throw new Error("mac ffmpeg/ffprobe missing after extract");
    cpSync(ff, dests[0]);
    cpSync(pr, dests[1]);
  } else {
    const archive = path.join(cache, spec.file);
    if (!existsSync(archive) || force) await download(spec.url, archive);
    const tmp = path.join(cache, "ffmpeg-extract");
    extractArchive(archive, tmp);
    const ffFound = findNamed(tmp, [spec.bins[0]]);
    const prFound = findNamed(tmp, [spec.bins[1]]);
    if (!ffFound || !prFound) throw new Error(`ffmpeg missing in ${spec.file}`);
    cpSync(ffFound, dests[0]);
    cpSync(prFound, dests[1]);
  }
  dests.forEach(chmod755);
  console.log("ffmpeg", dests[0]);
}

function ytDlpName() {
  if (win) return "yt-dlp.exe";
  if (mac) return "yt-dlp_macos";
  if (arch === "arm64") return "yt-dlp_linux_aarch64";
  return "yt-dlp_linux";
}

async function bundleYtDlp() {
  const dest = path.join(bin, win ? "yt-dlp.exe" : "yt-dlp");
  if (have(dest)) return console.log("skip yt-dlp");
  await download(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytDlpName()}`, dest);
  chmod755(dest);
  console.log("yt-dlp", dest);
}

function pythonAssetPred(n) {
  if (!n.includes("cpython-3.12") || !n.includes("install_only.tar.gz") || n.includes("sha256")) return false;
  if (win) return n.includes("x86_64-pc-windows-msvc");
  if (mac && arch === "arm64") return n.includes("aarch64-apple-darwin");
  if (mac) return n.includes("x86_64-apple-darwin");
  if (arch === "arm64") return n.includes("aarch64-unknown-linux-gnu");
  return n.includes("x86_64-unknown-linux-gnu");
}

function pythonBin() {
  return win ? path.join(pythonDir, "python.exe") : path.join(pythonDir, "bin", "python3");
}

async function bundlePython() {
  const py = pythonBin();
  if (have(py) && existsSync(path.join(pythonDir, ".sorotin-ok"))) return console.log("skip python");
  const url = await githubAsset("astral-sh/python-build-standalone", pythonAssetPred);
  const tar = path.join(cache, `cpython-3.12-${process.platform}-${arch}.tar.gz`);
  if (!existsSync(tar) || force) await download(url, tar);
  rmSync(pythonDir, { recursive: true, force: true });
  mkdirSync(res, { recursive: true });
  run("tar", ["-xzf", tar, "-C", res]);
  if (!existsSync(py)) throw new Error(`python missing after extract: ${py}`);
  chmod755(py);
  run(py, ["-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"]);
  run(py, [
    "-m",
    "pip",
    "install",
    "faster-whisper",
    "opencv-python-headless>=4.8,<5",
    "pillow",
  ]);
  run(py, ["-c", "import faster_whisper, cv2, PIL; print('python ok')"]);
  writeFileSync(path.join(pythonDir, ".sorotin-ok"), "ok\n");
  console.log("python", py);
}

const FONT_URL =
  "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Black.ttf";

async function bundleFonts() {
  const dest = path.join(fonts, "NotoSans-Black.ttf");
  if (have(dest)) return console.log("skip font");
  const vendored = path.join(root, "vendor", "fonts", "NotoSans-Black.ttf");
  const local = "/usr/share/fonts/noto/NotoSans-Black.ttf";
  if (existsSync(vendored)) {
    cpSync(vendored, dest);
  } else if (existsSync(local)) {
    cpSync(local, dest);
  } else {
    await download(FONT_URL, dest);
  }
  console.log("font", dest);
}

function bundleScripts() {
  const dest = path.join(res, "scripts");
  rmSync(dest, { recursive: true, force: true });
  cpSync(path.join(root, "scripts"), dest, {
    recursive: true,
    filter: (p) => !p.endsWith(".mjs") && !p.includes("bundle-sidecars"),
  });
  console.log("scripts", dest);
}

function verify() {
  const names = win ? ["node.exe", "ffmpeg.exe", "ffprobe.exe", "yt-dlp.exe"] : ["node", "ffmpeg", "ffprobe", "yt-dlp"];
  for (const name of names) {
    const p = path.join(bin, name);
    if (!existsSync(p)) throw new Error(`missing ${p}`);
  }
  const ffmpeg = path.join(bin, win ? "ffmpeg.exe" : "ffmpeg");
  const ass = spawnSync(ffmpeg, ["-hide_banner", "-filters"], { encoding: "utf8" });
  const out = `${ass.stdout || ""}\n${ass.stderr || ""}`;
  if (!/\bass\b/.test(out)) throw new Error("bundled ffmpeg has no ass filter (need libass)");
  if (!/\bdrawtext\b/.test(out)) throw new Error("bundled ffmpeg has no drawtext filter");
  console.log("verify ok");
}

const steps = [bundleNode, bundleFfmpeg, bundleYtDlp, bundlePython, bundleFonts, bundleScripts, verify];
for (const step of steps) {
  await step();
}
console.log("sidecars ready in", res);
