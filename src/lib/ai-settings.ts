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
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2));
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
  return baseUrl.replace(/\/$/, "").replace(/\/chat\/completions\s*$/, "");
}
