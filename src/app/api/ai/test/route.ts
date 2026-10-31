import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AiEndpointError, testAiConnection } from "@/lib/ai";
import { guardApiRequest } from "@/lib/request-guard";

export const dynamic = "force-dynamic";

/** Real tiny call: GET /models + (optional) a 1-line JSON chat with the chosen model. */
export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  const body = z
    .object({ baseUrl: z.string().optional(), apiKey: z.string().optional(), model: z.string().optional() })
    .parse(await req.json().catch(() => ({})));
  try {
    const result = await testAiConnection(body);
    return NextResponse.json({ status: true, data: result });
  } catch (e) {
    if (e instanceof AiEndpointError) {
      return NextResponse.json({ status: false, message: e.message }, { status: 400 });
    }
    throw e;
  }
}
