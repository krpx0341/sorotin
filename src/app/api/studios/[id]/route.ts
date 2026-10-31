import { NextRequest, NextResponse } from "next/server";
import { isBusyStatus, stopJob } from "@/lib/jobs";
import { denyIfUnlicensed } from "@/lib/license-guard";
import { processStudio, rerenderStudio } from "@/lib/pipeline";
import { loadStudio, saveStudio } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const denied = denyIfUnlicensed();
  if (denied) return denied;
  const { id } = await ctx.params;
  const studio = loadStudio(id);
  if (!studio) return NextResponse.json({ status: false, message: "not found" }, { status: 404 });
  return NextResponse.json({ status: true, data: studio });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const denied = denyIfUnlicensed();
  if (denied) return denied;
  const { id } = await ctx.params;
  const studio = loadStudio(id);
  if (!studio) return NextResponse.json({ status: false, message: "not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { action?: string };

  if (body.action === "stop") {
    stopJob(id);
    const cur = loadStudio(id) || studio;
    saveStudio({
      ...cur,
      status: "error",
      error: "Stopped",
      progress: { pct: cur.progress?.pct ?? 0, message: "Stopped" },
      updatedAt: new Date().toISOString(),
    });
    return NextResponse.json({ status: true, data: loadStudio(id) });
  }

  if (body.action === "reprocess") {
    if (isBusyStatus(studio.status)) stopJob(id);
    const next = {
      ...studio,
      status: "queued" as const,
      error: undefined,
      progress: { pct: 0, message: "Queued…" },
      updatedAt: new Date().toISOString(),
    };
    saveStudio(next);
    void processStudio(id);
  }

  if (body.action === "rerender") {
    if (isBusyStatus(studio.status)) stopJob(id);
    const next = {
      ...studio,
      status: "queued" as const,
      error: undefined,
      progress: { pct: 0, message: "Re-render queued…" },
      updatedAt: new Date().toISOString(),
    };
    saveStudio(next);
    void rerenderStudio(id);
  }

  return NextResponse.json({ status: true, data: loadStudio(id) });
}
