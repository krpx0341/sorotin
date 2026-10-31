import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const STORED = vi.hoisted(() => "sk-test-stored-not-real");

vi.mock("@/lib/ai-settings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai-settings")>("@/lib/ai-settings");
  return {
    ...actual,
    loadAiSettings: () => ({
      baseUrl: "http://127.0.0.1:20128/v1",
      apiKey: STORED,
      model: "fake-model",
      enabled: true,
    }),
    saveAiSettings: () => {
      throw new Error("refusing to write settings in tests");
    },
  };
});

import { listAiModels } from "@/lib/ai";
import { GET, POST } from "./ai/models/route";
import { POST as postTest } from "./ai/test/route";

const STORED_BASE = "http://127.0.0.1:20128/v1";
const EXPLICIT = "sk-test-explicit-not-real";

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith("/models")) {
    return new Response(JSON.stringify({ data: [{ id: "fake-model", owned_by: "test" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

function authorization(call: unknown[]): string | null {
  const init = call[1] as RequestInit | undefined;
  return new Headers(init?.headers).get("authorization");
}

function saw(secret: string) {
  return fetchMock.mock.calls.some((call) => JSON.stringify(call).includes(secret));
}

function post(path: string, body: unknown, headers: Record<string, string>) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/ai/models", () => {
  it("rejects a foreign Origin with 403 and does not call fetch", async () => {
    const res = await POST(
      post(
        "/api/ai/models",
        { baseUrl: "http://192.0.2.8/v1" },
        { origin: "https://evil.example", "content-type": "application/json" },
      ),
    );
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(await res.json())).not.toContain(STORED);
  });

  it("rejects a cross-site request that omits Origin", async () => {
    const res = await POST(
      post(
        "/api/ai/models",
        { baseUrl: "http://192.0.2.8/v1" },
        { "content-type": "application/json", "sec-fetch-site": "cross-site" },
      ),
    );
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON content type with 415 and does not call fetch", async () => {
    const res = await POST(
      post(
        "/api/ai/models",
        JSON.stringify({ baseUrl: "http://192.0.2.8/v1" }),
        { origin: "http://localhost:3000", "content-type": "text/plain" },
      ),
    );
    expect(res.status).toBe(415);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(await res.json())).not.toContain(STORED);
  });

  it("returns 400 for a new baseUrl without apiKey and never sends the stored key", async () => {
    const res = await POST(
      post(
        "/api/ai/models",
        { baseUrl: "http://192.0.2.8/v1", refresh: true },
        { origin: "http://127.0.0.1:17300", "content-type": "application/json" },
      ),
    );
    const payload = await res.json();
    expect(res.status).toBe(400);
    expect(payload.status).toBe(false);
    expect(JSON.stringify(payload)).not.toContain(STORED);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(saw(STORED)).toBe(false);
  });

  it("uses the stored key for an allowed origin and the same baseUrl", async () => {
    const res = await POST(
      post(
        "/api/ai/models",
        { baseUrl: `${STORED_BASE}/`, refresh: true },
        { origin: "http://localhost:3000", "content-type": "application/json" },
      ),
    );
    const payload = await res.json();
    expect(res.status).toBe(200);
    expect(payload.status).toBe(true);
    expect(payload.data.models).toEqual([{ id: "fake-model", owned_by: "test" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${STORED_BASE}/models`);
    expect(authorization(fetchMock.mock.calls[0])).toBe(`Bearer ${STORED}`);
  });

  it("uses the stored key for a Tauri origin when the base URL matches", async () => {
    const res = await POST(
      post(
        "/api/ai/models",
        { refresh: true },
        { origin: "tauri://localhost", "content-type": "application/json" },
      ),
    );
    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${STORED_BASE}/models`);
    expect(authorization(fetchMock.mock.calls[0])).toBe(`Bearer ${STORED}`);
  });

  it("sends only the explicit key when baseUrl differs", async () => {
    const res = await POST(
      post(
        "/api/ai/models",
        { baseUrl: "http://192.0.2.8/v1", apiKey: EXPLICIT, refresh: true },
        { origin: "https://tauri.localhost", "content-type": "application/json" },
      ),
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://192.0.2.8/v1/models");
    expect(authorization(fetchMock.mock.calls[0])).toBe(`Bearer ${EXPLICIT}`);
    expect(saw(STORED)).toBe(false);
  });

  it("allows a non-browser request with no Origin to use the stored key", async () => {
    const res = await POST(
      post("/api/ai/models", { refresh: true }, { "content-type": "application/json" }),
    );
    expect(res.status).toBe(200);
    expect(authorization(fetchMock.mock.calls[0])).toBe(`Bearer ${STORED}`);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${STORED_BASE}/models`);
  });
});

describe("GET /api/ai/models", () => {
  it("rejects a foreign Origin with 403 and does not call fetch", async () => {
    const res = await GET(
      new NextRequest("http://127.0.0.1:17300/api/ai/models", {
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/ai/test", () => {
  it("rejects a foreign Origin with 403 and does not call fetch", async () => {
    const res = await postTest(
      post(
        "/api/ai/test",
        { baseUrl: "http://192.0.2.8/v1" },
        { origin: "https://evil.example", "content-type": "application/json" },
      ),
    );
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON content type with 415 and does not call fetch", async () => {
    const res = await postTest(
      post("/api/ai/test", "{}", { origin: "http://localhost:3000", "content-type": "text/plain" }),
    );
    expect(res.status).toBe(415);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a new baseUrl without apiKey and never sends the stored key", async () => {
    const res = await postTest(
      post(
        "/api/ai/test",
        { baseUrl: "http://192.0.2.8/v1", model: "fake-model" },
        { origin: "http://127.0.0.1:3000", "content-type": "application/json" },
      ),
    );
    const payload = await res.json();
    expect(res.status).toBe(400);
    expect(JSON.stringify(payload)).not.toContain(STORED);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(saw(STORED)).toBe(false);
  });

  it("uses the stored key for an allowed origin and the same baseUrl", async () => {
    const res = await postTest(
      post(
        "/api/ai/test",
        { baseUrl: STORED_BASE },
        { origin: "http://127.0.0.1:17300", "content-type": "application/json; charset=utf-8" },
      ),
    );
    const payload = await res.json();
    expect(res.status).toBe(200);
    expect(payload.status).toBe(true);
    expect(payload.data.endpoint.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${STORED_BASE}/models`);
    expect(authorization(fetchMock.mock.calls[0])).toBe(`Bearer ${STORED}`);
  });
});

describe("listAiModels", () => {
  it("does not fetch when the base URL differs and no apiKey is passed", async () => {
    await expect(listAiModels({ baseUrl: "http://192.0.2.8/v1", refresh: true })).rejects.toThrow(/kunci tersimpan/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(saw(STORED)).toBe(false);
  });
});
