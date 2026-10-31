import { describe, expect, it } from "vitest";
import { extractChatContent, friendlyAiError, parseJsonLoose } from "./ai";

describe("ai transport helpers", () => {
  it("reads normal and SSE chat responses", () => {
    expect(extractChatContent(JSON.stringify({ choices: [{ message: { content: '{"a":1}' } }] }))).toBe('{"a":1}');
    const sse = [
      'data: {"choices":[{"delta":{"content":"{\\"ok\\""}}]}',
      'data: {"choices":[{"delta":{"content":":true}"}}]}',
      "data: [DONE]",
    ].join("\n");
    expect(extractChatContent(sse)).toBe('{"ok":true}');
  });

  it("parses fenced / chatty JSON", () => {
    expect(parseJsonLoose('```json\n{"clips":[]}\n```')).toEqual({ clips: [] });
    expect(parseJsonLoose('Here you go: {"x":2} thanks')).toEqual({ x: 2 });
  });

  it("explains failures in Indonesian", () => {
    const refused = new TypeError("fetch failed");
    (refused as unknown as { cause: { code: string } }).cause = { code: "ECONNREFUSED" };
    expect(friendlyAiError(refused, "http://127.0.0.1:20128/v1")).toMatch(/Tidak ada server.*127\.0\.0\.1:20128/);
    expect(friendlyAiError(new Error('chat 503: {"message":"Insufficient balance (reset after 2m)"}'))).toMatch(/Saldo.*2m/);
    expect(friendlyAiError(new Error("chat 401: invalid api key"))).toMatch(/API key ditolak/);
  });
});
