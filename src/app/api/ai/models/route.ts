import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AiEndpointError, friendlyAiError, listAiModels } from "@/lib/ai";
import { guardApiRequest } from "@/lib/request-guard";

export const dynamic = "force-dynamic";

async function respond(opts: { baseUrl?: string; apiKey?: string; refresh?: boolean }) {
  const t0 = Date.now();
  try {
    // Client key only. The stored key is attached inside listAiModels, and only
    // when this base URL matches the saved one.
    const models = await listAiModels({ baseUrl: opts.baseUrl, apiKey: opts.apiKey, refresh: opts.refresh });
    return NextResponse.json({ status: true, data: { models, ms: Date.now() - t0 } });
  } catch (e) {
    if (e instanceof AiEndpointError) {
      return NextResponse.json({ status: false, message: e.message }, { status: 400 });
    }
    return NextResponse.json(
      { status: false, message: friendlyAiError(e, opts.baseUrl), data: { ms: Date.now() - t0 } },
      { status: 400 },
    );
  }
}

export async function GET(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  return respond({ refresh: req.nextUrl.searchParams.get("refresh") === "1" });
}

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  const body = z
    .object({ baseUrl: z.string().optional(), apiKey: z.string().optional(), refresh: z.boolean().optional() })
    .parse(await req.json().catch(() => ({})));
  return respond(body);
}
