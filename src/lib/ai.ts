import { randomUUID } from "node:crypto";
import { loadAiSettings, normalizeOpenAiBase } from "./ai-settings";
import type { ClipCandidate, TranscriptSegment } from "./types";

export type AiModel = { id: string; owned_by?: string };

function authHeaders(apiKey: string) {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

export async function listAiModels(opts?: {
  baseUrl?: string;
  apiKey?: string;
}): Promise<AiModel[]> {
  const settings = loadAiSettings();
  const base = normalizeOpenAiBase(opts?.baseUrl || settings.baseUrl);
  const apiKey = opts?.apiKey ?? settings.apiKey;
  const res = await fetch(`${base}/models`, {
    headers: authHeaders(apiKey),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`models ${res.status}: ${body.slice(0, 240)}`);
  }
  const json = (await res.json()) as { data?: Array<{ id: string; owned_by?: string }> };
  return (json.data || [])
    .map((m) => ({ id: m.id, owned_by: m.owned_by }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function chatJson(system: string, user: string): Promise<unknown> {
  const settings = loadAiSettings();
  if (!settings.enabled) throw new Error("AI ranking disabled");
  if (!settings.model) throw new Error("AI model belum dipilih");
  const base = normalizeOpenAiBase(settings.baseUrl);
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: authHeaders(settings.apiKey),
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`chat ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  const text: string | undefined = json?.choices?.[0]?.message?.content;
  if (!text) throw new Error("AI kosong");
  return JSON.parse(text);
}

/** Ask LLM to pick viral short windows from transcript. Falls back by throwing. */
export async function rankClipsWithAi(
  segments: TranscriptSegment[],
  durationSec: number,
  opts: { targetSec?: number; maxClips?: number } = {},
): Promise<ClipCandidate[]> {
  const target = opts.targetSec ?? 40;
  const maxClips = opts.maxClips ?? 8;
  if (!segments.length) throw new Error("transcript kosong untuk AI ranking");

  // Compact transcript for token budget.
  const lines = segments
    .map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`)
    .join("\n")
    .slice(0, 14000);

  const system = `You are a short-form video producer like OpusClip/ClipperStudio.
Pick the best clip windows for TikTok/Reels/Shorts from a transcript.
Return ONLY JSON:
{"clips":[{"start":number,"end":number,"title":string,"score":number,"reason":string}]}
Rules:
- start/end in seconds within 0..${durationSec}
- each clip duration about ${Math.max(20, target - 10)}-${target + 10} seconds
- max ${maxClips} clips, non-overlapping as much as possible
- prefer hooks, curiosity, tips, emotion, punchlines
- title = short hook text (<=70 chars), language same as transcript
- score 0..1`;

  const raw = (await chatJson(system, `Duration=${durationSec}s\nTranscript:\n${lines}`)) as {
    clips?: Array<{ start: number; end: number; title?: string; score?: number; reason?: string }>;
  };

  const mapped: ClipCandidate[] = [];
  for (const c of raw.clips || []) {
    const start = Number(c.start);
    const end = Number(c.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 8) continue;
    mapped.push({
      id: String(randomUUID()),
      start: Number(Math.max(0, start).toFixed(2)),
      end: Number(Math.min(durationSec, end).toFixed(2)),
      score: Number(Math.min(1, Math.max(0, Number(c.score ?? 0.7))).toFixed(3)),
      title: String(c.title || "AI Clip").slice(0, 72),
      reason: `ai: ${String(c.reason || "ranked").slice(0, 120)}`,
    });
  }
  const clips = mapped
    .sort((a, b) => b.score - a.score)
    .slice(0, maxClips)
    .sort((a, b) => a.start - b.start);

  if (!clips.length) throw new Error("AI tidak mengembalikan clip valid");
  return clips;
}
