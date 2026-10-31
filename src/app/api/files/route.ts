import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { denyIfUnlicensed } from "@/lib/license-guard";
import { resolvePublicFile } from "@/lib/store";

function mediaType(ext: string): string {
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".wav") return "audio/wav";
  return "application/octet-stream";
}

function parseRange(header: string | null, size: number): { start: number; end: number } | "unsat" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!m) return null;
  const hasStart = m[1] !== "";
  const hasEnd = m[2] !== "";
  if (!hasStart && !hasEnd) return null;
  let start: number;
  let end: number;
  if (!hasStart) {
    const suffix = Number(m[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return "unsat";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = hasEnd ? Number(m[2]) : size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size) return "unsat";
  end = Math.min(end, size - 1);
  if (start > end) return "unsat";
  return { start, end };
}

function readSlice(abs: string, start: number, end: number): Buffer {
  const len = end - start + 1;
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(abs, "r");
  try {
    fs.readSync(fd, buf, 0, len, start);
  } finally {
    fs.closeSync(fd);
  }
  return buf;
}

export async function GET(req: NextRequest) {
  const denied = denyIfUnlicensed();
  if (denied) return denied;
  const rel = req.nextUrl.searchParams.get("path");
  if (!rel) return NextResponse.json({ error: "path required" }, { status: 400 });
  const abs = resolvePublicFile(decodeURIComponent(rel));
  if (!abs) return NextResponse.json({ error: "bad path" }, { status: 400 });
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    return NextResponse.json({ error: "missing" }, { status: 404 });
  }
  if (!stat.isFile()) return NextResponse.json({ error: "missing" }, { status: 404 });

  const type = mediaType(path.extname(abs).toLowerCase());
  const size = stat.size;
  const range = parseRange(req.headers.get("range"), size);

  if (range === "unsat") {
    return new NextResponse(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}` },
    });
  }

  if (range) {
    const body = readSlice(abs, range.start, range.end);
    return new NextResponse(new Uint8Array(body), {
      status: 206,
      headers: {
        "Content-Type": type,
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(body.length),
        "Cache-Control": "private, max-age=60",
      },
    });
  }

  const buf = fs.readFileSync(abs);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": type,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=60",
    },
  });
}
