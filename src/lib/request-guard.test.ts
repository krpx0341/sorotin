import { describe, expect, it } from "vitest";
import { ALLOWED_ORIGINS, guardApiRequest, isAllowedOrigin } from "./request-guard";

function call(method: string, headers: Record<string, string>, opts?: { allowMultipart?: boolean }) {
  return guardApiRequest(
    new Request("http://127.0.0.1:17300/api/ai/models", {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : "{}",
    }),
    opts,
  );
}

describe("isAllowedOrigin", () => {
  it("allows the dev, desktop, and Tauri origins", () => {
    for (const origin of ALLOWED_ORIGINS) {
      expect(isAllowedOrigin(origin), origin).toBe(true);
    }
    expect(isAllowedOrigin("http://localhost:3000/")).toBe(true);
  });

  it("rejects a foreign origin and the opaque null origin", () => {
    expect(isAllowedOrigin("https://evil.example")).toBe(false);
    expect(isAllowedOrigin("null")).toBe(false);
    expect(isAllowedOrigin("http://localhost:3001")).toBe(false);
    expect(isAllowedOrigin("http://192.168.1.20:3000")).toBe(false);
    expect(isAllowedOrigin("tauri://evil.example")).toBe(false);
  });
});

describe("guardApiRequest", () => {
  it("rejects a foreign Origin with 403 before the content-type check", () => {
    const res = call("POST", { origin: "https://evil.example", "content-type": "text/plain" });
    expect(res?.status).toBe(403);
  });

  it("rejects a missing Origin when Sec-Fetch-Site is cross-site", () => {
    expect(call("GET", { "sec-fetch-site": "cross-site" })?.status).toBe(403);
  });

  it("allows a missing Origin for a non-browser client", () => {
    expect(call("POST", { "content-type": "application/json" })).toBeNull();
  });

  it("rejects a non-JSON mutation with 415", () => {
    expect(call("POST", { origin: "http://localhost:3000", "content-type": "text/plain" })?.status).toBe(415);
    expect(call("PUT", { origin: "http://127.0.0.1:17300", "content-type": "application/x-www-form-urlencoded" })?.status).toBe(415);
  });

  it("allows application/json with a charset and opted-in multipart", () => {
    expect(call("POST", { origin: "tauri://localhost", "content-type": "application/json; charset=utf-8" })).toBeNull();
    expect(
      call(
        "POST",
        { origin: "http://tauri.localhost", "content-type": "multipart/form-data; boundary=abc" },
        { allowMultipart: true },
      ),
    ).toBeNull();
  });
});
