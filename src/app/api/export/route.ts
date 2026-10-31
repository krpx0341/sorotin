import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { denyIfUnlicensed } from "@/lib/license-guard";
import { downloadsDir, openLocal, safeFileName, uniqueDest } from "@/lib/local-file";
import { resolvePublicFile } from "@/lib/store";

export async function POST(req: NextRequest) {
  const denied = denyIfUnlicensed();
  if (denied) return denied;
  let body: { path?: string; filename?: string; play?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ status: false, message: "bad json" }, { status: 400 });
  }
  const abs = typeof body.path === "string" ? resolvePublicFile(body.path) : null;
  if (!abs || !fs.existsSync(/* turbopackIgnore: true */ abs) || !fs.statSync(/* turbopackIgnore: true */ abs).isFile()) {
    return NextResponse.json({ status: false, message: "file tidak ada" }, { status: 404 });
  }
  if (body.play) {
    openLocal(abs);
    return NextResponse.json({ status: true, data: { opened: abs } });
  }
  const dir = downloadsDir();
  fs.mkdirSync(/* turbopackIgnore: true */ dir, { recursive: true });
  const dest = uniqueDest(dir, safeFileName(body.filename || "clip.mp4"));
  fs.copyFileSync(/* turbopackIgnore: true */ abs, dest);
  openLocal(dest);
  return NextResponse.json({ status: true, data: { saved: dest } });
}
