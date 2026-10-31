import { describe, expect, it } from "vitest";
import { cleanStudioTitle, studioDisplayTitle } from "./title";

describe("cleanStudioTitle", () => {
  it("strips emoji, fixes ALL CAPS, keeps censored words as-is", () => {
    const t = cleanStudioTitle(
      "DISVMPAHI, DIFI-TN*H SAMPAI DI N- 0- D41 AYAH⁉️ AKTE & IJAZAH DI B*-KR⁉️ “AKU BUTUH PERTOLONGAN‼️”",
    );
    expect(t).not.toMatch(/[⁉‼“”]/u);
    expect(t).toMatch(/^Disvmpahi, Difi-tn\*h Sampai di /);
    expect(t).toMatch(/Ayah\? Akte & Ijazah di B\*-kr\? Aku Butuh Pertolongan!$/);
  });

  it("leaves normal titles alone and keeps acronyms", () => {
    expect(cleanStudioTitle("Cara belajar AI dari nol 🚀🔥")).toBe("Cara belajar AI dari nol");
    expect(cleanStudioTitle("KISAH ANAK SMA YANG VIRAL")).toBe("Kisah Anak SMA yang Viral");
  });

  it("prefers a display title", () => {
    expect(studioDisplayTitle({ title: "RAW", displayTitle: "Nice" })).toBe("Nice");
    expect(studioDisplayTitle({ title: "", displayTitle: "  " })).toBe("Project tanpa judul");
  });
});
