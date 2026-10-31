import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { testAiConnection } from "@/lib/ai";

export const dynamic = "force-dynamic";

/** Real tiny call: GET /models + (optional) a 1-line JSON chat with the chosen model. */
export async function POST(req: NextRequest) {
  const body = z
    .object({ baseUrl: z.string().optional(), apiKey: z.string().optional(), model: z.string().optional() })
    .parse(await req.json().catch(() => ({})));
  const result = await testAiConnection(body);
  return NextResponse.json({ status: true, data: result });
}
