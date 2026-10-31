import { randomUUID } from "node:crypto";
import { loadAiSettings, normalizeOpenAiBase } from "./ai-settings";
import { overlaps } from "./clipper";
import { combineParts, gradesFromParts, sanitizeHook, sanitizeTitle } from "./scoring";
import type { ClipCandidate, ClipScoring, TranscriptSegment, ViralityGrades } from "./types";

export type AiModel = { id: string; owned_by?: string };

function authHeaders(apiKey: string) {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

type Endpoint = { baseUrl?: string; apiKey?: string };

/** Human (Indonesian) explanation for endpoint / provider failures. */
export function friendlyAiError(e: unknown, baseUrl = ""): string {
  const raw = e instanceof Error ? `${e.message} ${(e as { cause?: { code?: string; message?: string } }).cause?.code || ""}` : String(e);
  const host = (() => {
    try {
      return new URL(baseUrl).host;
    } catch {
      return baseUrl;
    }
  })();
  const reset = raw.match(/reset after ([0-9hms ]+?)\)/i)?.[1]?.trim();
  const later = reset ? ` Coba lagi ±${reset}.` : "";
  if (/ECONNREFUSED|fetch failed|ENOTFOUND|EHOSTUNREACH|ECONNRESET|socket hang up/i.test(raw))
    return `Tidak ada server yang menjawab di ${host || "base URL"}. Nyalakan 9router (atau cek base URL) lalu tes lagi.`;
  if (/TimeoutError|AbortError|aborted|timeout/i.test(raw)) return "Timeout — endpoint/model tidak menjawab tepat waktu.";
  if (/insufficient.balance|insufficient_quota|saldo/i.test(raw)) return `Saldo/kuota provider model ini habis.${later}`;
  if (/oauth_not_allowed|permission_error/i.test(raw)) return `Akun provider model ini ditolak (permission/OAuth).${later} Pilih rute lain.`;
  if (/\b(401|invalid.api.key|unauthorized)\b/i.test(raw)) return "API key ditolak (401). Cek API key 9router.";
  if (/\b404\b|not.found|model_not_found|does not exist/i.test(raw)) return `Model tidak tersedia di provider (404).${later}`;
  if (/\b429\b|rate.limit/i.test(raw)) return `Kena rate limit (429).${later}`;
  if (/\b403\b/i.test(raw)) return `Provider menolak akses (403).${later} Pilih rute lain.`;
  if (/\b50[0-9]\b/.test(raw)) return `Provider sedang error.${later}`;
  return raw.replace(/\s+/g, " ").trim().slice(0, 200);
}

const modelCache = new Map<string, { at: number; models: AiModel[] }>();

export async function listAiModels(opts?: Endpoint & { refresh?: boolean; timeoutMs?: number }): Promise<AiModel[]> {
  const settings = loadAiSettings();
  const base = normalizeOpenAiBase(opts?.baseUrl || settings.baseUrl);
  const apiKey = opts?.apiKey ?? settings.apiKey;
  const key = `${base}|${apiKey}`;
  const hit = modelCache.get(key);
  if (hit && !opts?.refresh && Date.now() - hit.at < 5 * 60_000) return hit.models;
  const res = await fetch(`${base}/models`, {
    headers: authHeaders(apiKey),
    cache: "no-store",
    signal: AbortSignal.timeout(opts?.timeoutMs ?? 20_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`models ${res.status}: ${body.slice(0, 240)}`);
  }
  const json = (await res.json()) as { data?: Array<{ id: string; owned_by?: string }> };
  const models = (json.data || [])
    .map((m) => ({ id: m.id, owned_by: m.owned_by }))
    .sort((a, b) => a.id.localeCompare(b.id));
  modelCache.set(key, { at: Date.now(), models });
  return models;
}

/**
 * Some 9router routes answer with SSE chunks even for non-stream requests.
 * Accept both a normal chat.completion JSON and "data: {...}" streams.
 */
export function extractChatContent(body: string): string {
  const t = body.trim();
  if (/^data:/m.test(t) && !t.startsWith("{")) {
    let out = "";
    for (const line of t.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload);
        if (j?.error) throw new Error(String(j.error.message || JSON.stringify(j.error)));
        out += j?.choices?.[0]?.delta?.content ?? j?.choices?.[0]?.message?.content ?? "";
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
    return out;
  }
  const j = JSON.parse(t);
  if (j?.error) throw new Error(String(j.error.message || JSON.stringify(j.error)));
  return j?.choices?.[0]?.message?.content ?? "";
}

/** Parse model JSON output, tolerating ```json fences or chatter around the object. */
export function parseJsonLoose(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error("AI tidak mengembalikan JSON");
  }
}

export async function chatCompletion(opts: Endpoint & {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  json?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<{ text: string; ms: number }> {
  const settings = loadAiSettings();
  const base = normalizeOpenAiBase(opts.baseUrl || settings.baseUrl);
  const t0 = Date.now();
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: authHeaders(opts.apiKey ?? settings.apiKey),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 240_000),
    body: JSON.stringify({
      model: opts.model,
      temperature: 0.2,
      stream: false,
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      messages: opts.messages,
    }),
  });
  const body = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`chat ${res.status}: ${body.slice(0, 400)}`);
  const text = extractChatContent(body);
  return { text, ms: Date.now() - t0 };
}

/** Tiny real call used by Settings → "Tes koneksi". */
export async function testAiConnection(opts: Endpoint & { model?: string }) {
  const settings = loadAiSettings();
  const baseUrl = normalizeOpenAiBase(opts.baseUrl || settings.baseUrl);
  const apiKey = opts.apiKey || settings.apiKey;
  const out: {
    baseUrl: string;
    endpoint: { ok: boolean; ms: number; modelCount?: number; error?: string };
    model?: { id: string; ok: boolean; ms: number; reply?: string; error?: string };
  } = { baseUrl, endpoint: { ok: false, ms: 0 } };
  let t0 = Date.now();
  try {
    const models = await listAiModels({ baseUrl, apiKey, refresh: true, timeoutMs: 15_000 });
    out.endpoint = { ok: true, ms: Date.now() - t0, modelCount: models.length };
  } catch (e) {
    out.endpoint = { ok: false, ms: Date.now() - t0, error: friendlyAiError(e, baseUrl) };
    return out;
  }
  if (opts.model) {
    t0 = Date.now();
    try {
      const { text } = await chatCompletion({
        baseUrl,
        apiKey,
        model: opts.model,
        json: true,
        maxTokens: 400,
        timeoutMs: 60_000,
        messages: [
          { role: "system", content: "Return only compact JSON." },
          { role: "user", content: 'Balas persis JSON ini: {"ok":true,"pesan":"siap"}' },
        ],
      });
      const reply = text.trim().slice(0, 120);
      out.model = { id: opts.model, ok: true, ms: Date.now() - t0, reply: reply || "(kosong)" };
      if (!reply) out.model = { ...out.model, ok: false, error: "Model menjawab kosong" };
    } catch (e) {
      out.model = { id: opts.model, ok: false, ms: Date.now() - t0, error: friendlyAiError(e, baseUrl) };
    }
  }
  return out;
}

async function chatJson(system: string, user: string): Promise<unknown> {
  const settings = loadAiSettings();
  if (!settings.enabled) throw new Error("AI ranking disabled");
  if (!settings.model) throw new Error("AI model belum dipilih");
  try {
    const { text } = await chatCompletion({
      model: settings.model,
      json: true,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    if (!text.trim()) throw new Error("AI kosong");
    return parseJsonLoose(text);
  } catch (e) {
    throw new Error(friendlyAiError(e, settings.baseUrl));
  }
}

const SCORING_RULES = `Scoring (be honest and calibrated — do NOT inflate):
- scores.hook 0-10: do the first 3 seconds make a stranger stop scrolling?
- scores.emotion 0-10: emotional charge (conflict, vulnerability, humor, surprise)
- scores.payoff 0-10: does it land a point/answer/punchline before it ends?
- scores.clarity 0-10: understandable standalone, without the rest of the video?
- A typical decent clip is 4-6. Use 8+ only when clearly exceptional. Low is fine.
- reasons: 2-3 very short phrases (max 8 words each) explaining the scores, same language as transcript.
- hook: on-screen hook line, max 8 words, punchy, curiosity-driven, same language as transcript.
  NOT a verbatim fragment; must make sense alone; no hashtags/emojis.`;

type AiScoreRaw = {
  hook?: string;
  title?: string;
  scores?: Partial<Record<"hook" | "emotion" | "payoff" | "clarity", number>>;
  reasons?: unknown;
};

function part(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 5;
  return Number(Math.min(10, Math.max(0, v > 10 ? v / 10 : v)).toFixed(1));
}

/** Map the model's per-clip scores to our ClipScoring (+ back-compat grades). */
export function aiScoring(
  raw: AiScoreRaw,
  model: string,
): { scoring: ClipScoring; grades: ViralityGrades; hook: string; title: string } {
  const parts = {
    hook: part(raw.scores?.hook),
    emotion: part(raw.scores?.emotion),
    payoff: part(raw.scores?.payoff),
    clarity: part(raw.scores?.clarity),
  };
  const reasons = (Array.isArray(raw.reasons) ? raw.reasons : typeof raw.reasons === "string" ? [raw.reasons] : [])
    .map((r) => String(r).trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((r) => r.slice(0, 80));
  return {
    scoring: { source: "ai", score: combineParts(parts), parts, reasons, model },
    grades: gradesFromParts(parts),
    hook: sanitizeHook(raw.hook),
    title: sanitizeTitle(raw.title),
  };
}

/** Grade already-chosen clips (e.g. on re-render) and write hooks for them. One call. */
export async function scoreClipsWithAi(
  items: Array<{ id: string; start: number; end: number; title: string; text: string }>,
): Promise<Map<string, { scoring: ClipScoring; grades: ViralityGrades; hook: string; title: string }>> {
  if (!items.length) return new Map();
  const settings = loadAiSettings();
  const system = `You grade short-form clips (TikTok/Reels/Shorts) cut from a longer video.
Return ONLY JSON: {"clips":[{"id":string,"title":string,"hook":string,"scores":{"hook":0-10,"emotion":0-10,"payoff":0-10,"clarity":0-10},"reasons":[string]}]}
${SCORING_RULES}

Title rules (the clip's name in the library and on the cover card):
- 4-9 words, max 60 characters, SAME language as the transcript
- say what the viewer gets (topic + angle/payoff), written as a headline, not a verbatim quote
- the "current title" is just raw transcript text: rewrite it, do not copy it
- no hashtags, no emoji, no quotes, no ALL CAPS, not identical to the hook`;
  const user = items
    .map((c) => `### id=${c.id} (${Math.round(c.end - c.start)}s) current title: ${c.title}\n${c.text.slice(0, 1800)}`)
    .join("\n\n");
  const raw = (await chatJson(system, user)) as { clips?: Array<AiScoreRaw & { id?: string }> };
  const out = new Map<string, { scoring: ClipScoring; grades: ViralityGrades; hook: string; title: string }>();
  for (const c of raw.clips || []) {
    if (!c.id || !items.some((x) => x.id === c.id)) continue;
    out.set(c.id, aiScoring(c, settings.model));
  }
  return out;
}

/** Short, calm project title for the studio header (raw YouTube titles are clickbait caps). */
export async function studioTitleWithAi(rawTitle: string, clipTitles: string[]): Promise<string> {
  const system = `You name a video project in a clipping app library.
Return ONLY JSON: {"title": string}
Rules:
- 3-8 words, max 56 characters, SAME language as the original title
- calm and descriptive: what the video is about (topic + who), sentence case
- no emoji, no hashtags, no quotes, no ALL CAPS, no clickbait punctuation
- the original may mask words on purpose (e.g. "DIFI-TN*H"): never un-mask them; keep sensitive topics neutral and non-graphic`;
  const user = `Original title: ${rawTitle}\nClip titles:\n${clipTitles.slice(0, 10).map((t) => `- ${t}`).join("\n")}`;
  const raw = (await chatJson(system, user)) as { title?: string };
  return sanitizeTitle(raw.title).replace(/[?!]$/, "");
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

  // Merge tiny Whisper segments into ~12s blocks so long videos fit the prompt
  // (previously the transcript was cut at 14k chars ≈ first 10 minutes only).
  const blocks: Array<{ start: number; end: number; text: string }> = [];
  for (const s of segments) {
    const last = blocks[blocks.length - 1];
    if (last && s.end - last.start <= 12 && s.start - last.end < 1.2) {
      last.end = s.end;
      last.text = `${last.text} ${s.text.trim()}`;
    } else {
      blocks.push({ start: s.start, end: s.end, text: s.text.trim() });
    }
  }
  const lines = blocks
    .map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`)
    .join("\n")
    .slice(0, 60000);

  const system = `You are a short-form producer competing with OpusClip.
Pick COMPLETE thought windows for TikTok/Reels/Shorts from a transcript.
Return ONLY JSON:
{"clips":[{"start":number,"end":number,"title":string,"hook":string,"scores":{"hook":0-10,"emotion":0-10,"payoff":0-10,"clarity":0-10},"reasons":[string]}]}

${SCORING_RULES}

Rules:
- start/end seconds within 0..${durationSec}
- each clip ~${Math.max(20, target - 10)}-${target + 10}s
- max ${maxClips} clips, minimize overlap
- ALWAYS cut on complete ideas (sentence / beat end), never mid-clause
- title = cover headline (<=60 chars), SAME language as transcript
- prefer conflict, confession, tips, numbers, before/after, questions`;

  const raw = (await chatJson(system, `Duration=${durationSec}s\nTranscript:\n${lines}`)) as {
    clips?: Array<AiScoreRaw & { start: number; end: number; title?: string; reason?: string }>;
  };
  const model = loadAiSettings().model;

  const mapped: ClipCandidate[] = [];
  for (const c of raw.clips || []) {
    const start = Number(c.start);
    const end = Number(c.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 8) continue;
    const { scoring, grades, hook, title } = aiScoring(c, model);
    mapped.push({
      id: String(randomUUID()),
      start: Number(Math.max(0, start).toFixed(2)),
      end: Number(Math.min(durationSec, end).toFixed(2)),
      score: Number((scoring.score / 100).toFixed(3)),
      title: title || hook || "AI Clip",
      titleSource: title ? "ai" : undefined,
      hook: hook || undefined,
      scoring,
      reason: scoring.reasons.join(" · ") || "AI",
      grades,
    });
  }
  const picked: ClipCandidate[] = [];
  for (const c of mapped.sort((a, b) => b.score - a.score)) {
    if (picked.length >= maxClips) break;
    if (picked.some((p) => overlaps(p, c))) continue;
    picked.push(c);
  }
  const clips = picked.sort((a, b) => a.start - b.start);

  if (!clips.length) throw new Error("AI tidak mengembalikan clip valid");
  return clips;
}
