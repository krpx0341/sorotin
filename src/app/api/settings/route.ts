import { NextRequest, NextResponse } from "next/server";
import { loadAiSettings, mergeAiSettingsUpdate, pickSettingsPatch, publicAiSettings, saveAiSettings } from "@/lib/ai-settings";
import { guardApiRequest } from "@/lib/request-guard";

export async function GET() {
  return NextResponse.json({ status: true, data: publicAiSettings() });
}

export async function PUT(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  const body = await req.json();
  const saved = saveAiSettings(mergeAiSettingsUpdate(loadAiSettings(), pickSettingsPatch(body)));
  return NextResponse.json({ status: true, data: publicAiSettings(saved) });
}
