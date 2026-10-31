import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { friendlyAiError, listAiModels } from "@/lib/ai";
import { loadAiSettings } from "@/lib/ai-settings";

export const dynamic = "force-dynamic";

async function respond(opts: { baseUrl?: string; apiKey?: string; refresh?: boolean }) {
  const settings = loadAiSettings();
  const baseUrl = opts.baseUrl || settings.baseUrl;
  const t0 = Date.now();
  try {
    const models = await listAiModels({ baseUrl, apiKey: opts.apiKey || settings.apiKey, refresh: opts.refresh });
    return NextResponse.json({ status: true, data: { models, ms: Date.now() - t0 } });
  } catch (e) {
    return NextResponse.json(
      { status: false, message: friendlyAiError(e, baseUrl), data: { ms: Date.now() - t0 } },
      { status: 400 },
    );
  }
}

export async function GET(req: NextRequest) {
  return respond({ refresh: req.nextUrl.searchParams.get("refresh") === "1" });
}

export async function POST(req: NextRequest) {
  const body = z
    .object({ baseUrl: z.string().optional(), apiKey: z.string().optional(), refresh: z.boolean().optional() })
    .parse(await req.json().catch(() => ({})));
  return respond(body);
}
