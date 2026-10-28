import { NextRequest, NextResponse } from "next/server";
import { aiSettingsSchema, loadAiSettings, publicAiSettings, saveAiSettings } from "@/lib/ai-settings";

export async function GET() {
  return NextResponse.json({ status: true, data: publicAiSettings() });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const parsed = aiSettingsSchema.partial().parse(body);
  // Keep existing key if client sends blank while has key already.
  if (parsed.apiKey === "" && loadAiSettings().apiKey) {
    delete parsed.apiKey;
  }
  const saved = saveAiSettings(parsed);
  return NextResponse.json({ status: true, data: publicAiSettings(saved) });
}
