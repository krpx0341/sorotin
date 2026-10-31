import { describe, expect, it } from "vitest";
import { fuzzyScore, hideViaDuplicates, parseModel, prettifyModelName, recommendModels } from "./model-catalog";

describe("model catalog", () => {
  it("parses routed ids into readable names", () => {
    const m = parseModel({ id: "9Stud/ag/claude-opus-4-6-thinking", owned_by: "9Stud" });
    expect(m.name).toBe("Claude Opus 4.6");
    expect(m.family).toBe("Claude");
    expect(m.provider).toBe("ag");
    expect(m.via).toBe("9Stud");
    expect(m.tags).toContain("thinking");
    expect(parseModel({ id: "cx/gpt-6-sol[1m]" }).name).toBe("GPT-6 Sol");
    expect(parseModel({ id: "cx/gpt-6-sol[1m]" }).tags).toContain("1M");
    expect(parseModel({ id: "ag/gemini-3.8-flash-high" }).name).toBe("Gemini 3.8 Flash");
    expect(parseModel({ id: "ag/gemini-3.8-flash-high" }).tags).toEqual(expect.arrayContaining(["high", "cepat"]));
    expect(parseModel({ id: "openrouter/google/gemma-4-31b-it:free" }).tags).toContain("free");
    expect(parseModel({ id: "Combo-all", owned_by: "combo" }).family).toBe("Combo");
    expect(parseModel({ id: "vikey/openai/gpt-image-2" }).chat).toBe(false);
    expect(prettifyModelName("claude-haiku-4-5-20251001").name).toBe("Claude Haiku 4.5");
  });

  it("dedupes meta-router copies and fuzzy matches", () => {
    const list = ["ag/claude-opus-5-5", "9Stud/ag/claude-opus-5-5", "9Stud/dattio/hy4"].map((id) => parseModel({ id }));
    expect(hideViaDuplicates(list).map((m) => m.id)).toEqual(["ag/claude-opus-5-5", "9Stud/dattio/hy4"]);
    expect(fuzzyScore("opus 5.5", list[0])).toBeGreaterThan(0);
    expect(fuzzyScore("cop55", list[0])).toBeGreaterThan(0);
    expect(fuzzyScore("gemini", list[0])).toBe(0);
  });

  it("recommends latest plain variants on preferred routes", () => {
    const ids = [
      "9Stud/ag/claude-opus-5-5",
      "cc/claude-opus-5-5",
      "ag/claude-opus-5-5",
      "ag/claude-opus-5-5-low",
      "ag/claude-opus-4-6-thinking",
      "ag/claude-sonnet-5-5",
      "cx/gpt-6.1-sol",
      "cx/gpt-6-sol[1m]",
      "cx/codex-auto-review",
      "ag/gemini-3.8-flash",
      "ag/gemini-3.6-flash-low",
    ];
    const recs = recommendModels(ids.map((id) => parseModel({ id })));
    expect(recs.map((r) => [r.key, r.model.id])).toEqual([
      ["smart", "ag/claude-opus-5-5"],
      ["balanced", "ag/claude-sonnet-5-5"],
      ["fast", "cx/gpt-6.1-sol"],
      ["cheap", "ag/gemini-3.8-flash"],
    ]);
  });
});
