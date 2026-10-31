import { describe, expect, it } from "vitest";
import { canonicalAiBase, mergeAiSettingsUpdate, pickSettingsPatch, resolveAiEndpoint, type AiSettings } from "./ai-settings";

const settings: AiSettings = {
  baseUrl: "http://127.0.0.1:20128/v1",
  apiKey: "sk-test-stored-not-real",
  model: "fake-model",
  enabled: true,
};

describe("resolveAiEndpoint", () => {
  it("treats a trailing slash and a pasted chat completions URL as the saved base", () => {
    const slash = resolveAiEndpoint({ baseUrl: "http://127.0.0.1:20128/v1/" }, settings);
    const pasted = resolveAiEndpoint({ baseUrl: "HTTP://127.0.0.1:20128/v1/chat/completions" }, settings);
    expect(slash).toEqual({ ok: true, baseUrl: canonicalAiBase(settings.baseUrl), apiKey: settings.apiKey });
    expect(pasted).toEqual({ ok: true, baseUrl: canonicalAiBase(settings.baseUrl), apiKey: settings.apiKey });
  });

  it("refuses a different base URL without an explicit apiKey", () => {
    const result = resolveAiEndpoint({ baseUrl: "http://192.0.2.8/v1", apiKey: "   " }, settings);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/kunci tersimpan tidak dikirim/);
      expect(result.message).not.toContain(settings.apiKey);
    }
  });

  it("uses only the explicit key when the base URL differs", () => {
    expect(resolveAiEndpoint({ baseUrl: "http://192.0.2.8/v1/", apiKey: "sk-test-explicit-not-real" }, settings)).toEqual({
      ok: true,
      baseUrl: "http://192.0.2.8/v1",
      apiKey: "sk-test-explicit-not-real",
    });
  });

  it("does not treat a userinfo URL as the saved base", () => {
    const result = resolveAiEndpoint({ baseUrl: "http://attacker@127.0.0.1:20128/v1" }, settings);
    expect(result.ok).toBe(false);
  });
});

describe("mergeAiSettingsUpdate", () => {
  it("drops the saved key when the base URL changes and no new key is sent", () => {
    expect(mergeAiSettingsUpdate(settings, { baseUrl: "http://192.0.2.8/v1" }).apiKey).toBe("");
    expect(mergeAiSettingsUpdate(settings, { baseUrl: "http://192.0.2.8/v1/" }).apiKey).toBe("");
  });

  it("keeps the saved key when the base URL is unchanged and the key field is blank", () => {
    const next = mergeAiSettingsUpdate(settings, { baseUrl: "http://127.0.0.1:20128/v1/", apiKey: "", model: "fake-model" });
    expect(next.apiKey).toBeUndefined();
  });

  it("stores an explicit key for a new base URL", () => {
    expect(mergeAiSettingsUpdate(settings, { baseUrl: "http://192.0.2.8/v1", apiKey: "sk-test-explicit-not-real" }).apiKey).toBe(
      "sk-test-explicit-not-real",
    );
  });

  it("ignores Zod defaults for fields the client did not send", () => {
    const patch = pickSettingsPatch({ model: "other-model" });
    expect(patch).toEqual({ model: "other-model" });
    expect(mergeAiSettingsUpdate(settings, patch).apiKey).toBeUndefined();
  });
});
