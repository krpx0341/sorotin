import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listAiModels } from "@/lib/ai";
import { loadAiSettings } from "@/lib/ai-settings";

export async function GET() {
  try {
    const models = await listAiModels();
    return NextResponse.json({ status: true, data: { models } });
  } catch (e) {
    return NextResponse.json(
      { status: false, message: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}

export async function POST(req: NextRequest) {
  const body = z
    .object({
      baseUrl: z.string().optional(),
      apiKey: z.string().optional(),
    })
    .parse(await req.json().catch(() => ({})));
  try {
    const settings = loadAiSettings();
    const models = await listAiModels({
      baseUrl: body.baseUrl || settings.baseUrl,
      apiKey: body.apiKey || settings.apiKey,
    });
    return NextResponse.json({ status: true, data: { models } });
  } catch (e) {
    return NextResponse.json(
      { status: false, message: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
