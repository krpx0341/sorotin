import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const SETTINGS_PATH = path.join(process.cwd(), "data", "settings.json");

export const aiSettingsSchema = z.object({
  baseUrl: z.string().default("http://127.0.0.1:20128/v1"),
  apiKey: z.string().default(""),
  model: z.string().default(""),
  enabled: z.boolean().default(false),
});

export type AiSettings = z.infer<typeof aiSettingsSchema>;

const DEFAULTS: AiSettings = {
  baseUrl: "http://127.0.0.1:20128/v1",
  apiKey: "",
  model: "",
  enabled: false,
};

function ensure() {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  if (!fs.existsSync(SETTINGS_PATH)) {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(DEFAULTS, null, 2));
  }
}

export function loadAiSettings(): AiSettings {
  ensure();
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    return aiSettingsSchema.parse({ ...DEFAULTS, ...raw });
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveAiSettings(partial: Partial<AiSettings>): AiSettings {
  const next = aiSettingsSchema.parse({ ...loadAiSettings(), ...partial });
  ensure();
  const tmp = `${SETTINGS_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, SETTINGS_PATH);
  return next;
}

export function publicAiSettings(settings = loadAiSettings()) {
  return {
    baseUrl: settings.baseUrl,
    model: settings.model,
    enabled: settings.enabled,
    hasApiKey: Boolean(settings.apiKey),
  };
}

export function normalizeOpenAiBase(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, "").replace(/\/chat\/completions$/i, "").replace(/\/+$/, "");
}

/**
 * Comparison key for an OpenAI-compatible base URL.
 * Trailing slashes and a pasted `/chat/completions` suffix collapse to one value.
 * Userinfo is kept distinct so `http://evil@stored-host` cannot match the saved URL.
 */
export function canonicalAiBase(baseUrl: string): string {
  const normalized = normalizeOpenAiBase(baseUrl);
  try {
    const url = new URL(normalized);
    if (url.username || url.password) return `userinfo:${normalized}`;
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.protocol}//${url.host}${path}`;
  } catch {
    return normalized;
  }
}

export type ResolvedAiEndpoint =
  | { ok: true; baseUrl: string; apiKey: string }
  | { ok: false; message: string };

/**
 * The saved API key is sent only to the saved base URL.
 * A different base URL must bring its own key; otherwise the caller has to stop
 * before any network request.
 */
export function resolveAiEndpoint(
  opts: { baseUrl?: string; apiKey?: string },
  settings: AiSettings,
): ResolvedAiEndpoint {
  const storedBase = canonicalAiBase(settings.baseUrl);
  const requested = opts.baseUrl?.trim();
  const baseUrl = canonicalAiBase(requested || settings.baseUrl);
  const explicit = typeof opts.apiKey === "string" && opts.apiKey.trim() !== "" ? opts.apiKey : undefined;
  if (baseUrl !== storedBase && explicit === undefined) {
    return {
      ok: false,
      message:
        "Base URL berbeda dari yang tersimpan. Masukkan API key untuk endpoint ini — kunci tersimpan tidak dikirim.",
    };
  }
  return { ok: true, baseUrl, apiKey: explicit ?? settings.apiKey };
}

/**
 * Changing the saved base URL without a new key must not keep the old key.
 * A blank key on an unchanged base URL still means "leave the saved key".
 */
export function mergeAiSettingsUpdate(current: AiSettings, partial: Partial<AiSettings>): Partial<AiSettings> {
  const next = { ...partial };
  const baseChanged =
    next.baseUrl !== undefined && canonicalAiBase(next.baseUrl) !== canonicalAiBase(current.baseUrl);
  const explicitKey = typeof next.apiKey === "string" && next.apiKey.trim() !== "";
  if (baseChanged && !explicitKey) next.apiKey = "";
  else if (next.apiKey === "" && current.apiKey) delete next.apiKey;
  return next;
}

/** Copy only fields the client actually sent. Zod defaults must not look like a base-URL change. */
export function pickSettingsPatch(raw: unknown): Partial<AiSettings> {
  const parsed = aiSettingsSchema.partial().parse(raw);
  const present = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const patch: Partial<AiSettings> = {};
  if (typeof present.baseUrl === "string") patch.baseUrl = parsed.baseUrl;
  if (typeof present.apiKey === "string") patch.apiKey = parsed.apiKey;
  if (typeof present.model === "string") patch.model = parsed.model;
  if (typeof present.enabled === "boolean") patch.enabled = parsed.enabled;
  return patch;
}
