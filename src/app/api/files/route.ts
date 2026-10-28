import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

const ALLOWED_ROOTS = ["data", "public"];

export async function GET(req: NextRequest) {
  const rel = req.nextUrl.searchParams.get("path");
  if (!rel) return NextResponse.json({ error: "path required" }, { status: 400 });
  const decoded = decodeURIComponent(rel);
  if (decoded.includes("..")) return NextResponse.json({ error: "bad path" }, { status: 400 });
  const top = decoded.split("/")[0];
  if (!ALLOWED_ROOTS.includes(top)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const abs = path.join(process.cwd(), decoded);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return NextResponse.json({ error: "missing" }, { status: 404 });
  }
  const buf = fs.readFileSync(abs);
  const ext = path.extname(abs).toLowerCase();
  const type =
    ext === ".mp4"
      ? "video/mp4"
      : ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : ext === ".png"
          ? "image/png"
          : ext === ".wav"
            ? "audio/wav"
            : "application/octet-stream";
  return new NextResponse(buf, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, max-age=60",
    },
  });
}
