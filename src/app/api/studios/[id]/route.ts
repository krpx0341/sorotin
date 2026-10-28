import { NextRequest, NextResponse } from "next/server";
import { loadStudio } from "@/lib/store";
import { processStudio } from "@/lib/pipeline";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const studio = loadStudio(id);
  if (!studio) return NextResponse.json({ status: false, message: "not found" }, { status: 404 });
  return NextResponse.json({ status: true, data: studio });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const studio = loadStudio(id);
  if (!studio) return NextResponse.json({ status: false, message: "not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action === "reprocess") {
    studio.status = "queued";
    studio.error = undefined;
    const { saveStudio } = await import("@/lib/store");
    saveStudio(studio);
    void processStudio(id);
  }
  return NextResponse.json({ status: true, data: loadStudio(id) });
}
