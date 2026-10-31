import { describe, expect, it } from "vitest";
import { combineParts, localHookLine, localScoring, localTitle, sanitizeHook, sanitizeTitle } from "./scoring";
import type { TranscriptSegment } from "./types";

const seg = (start: number, end: number, text: string): TranscriptSegment => ({ start, end, text });

describe("honest scoring", () => {
  it("does not saturate on long chatty text", () => {
    const chatty: TranscriptSegment[] = [];
    for (let t = 0; t < 50; t += 5) chatty.push(seg(t, t + 4.8, "Terus karena itu caranya ya gitu kan, jadi cara dia tuh karena apa?"));
    const s = localScoring(chatty, 0, 50);
    expect(s.source).toBe("local");
    expect(s.score).toBeLessThan(70);
  });

  it("rewards a strong opening question + emotional payoff over a flat clip", () => {
    const strong = [
      seg(0, 3, "Kenapa kamu takut pulang ke rumah?"),
      seg(3.3, 9, "Aku trauma, tiap malam aku nangis sendirian."),
      seg(9.4, 25, "Akhirnya aku sadar, intinya aku harus berani ngomong ke mama."),
    ];
    const flat = [seg(0, 6, "dan terus itu yang tadi"), seg(6.2, 25, "yang di sana itu juga sama terus dia ke situ dan")];
    expect(localScoring(strong, 0, 25).score).toBeGreaterThan(localScoring(flat, 0, 25).score + 15);
    expect(localScoring(strong, 0, 25).reasons.join(" ")).toMatch(/pertanyaan/i);
  });

  it("weights parts into 0-100", () => {
    expect(combineParts({ hook: 10, emotion: 10, payoff: 10, clarity: 10 })).toBe(100);
    expect(combineParts({ hook: 5, emotion: 5, payoff: 5, clarity: 5 })).toBe(50);
  });
});

describe("hook line", () => {
  it("is short, whole-word and sentence-cased", () => {
    const segs = [
      seg(0, 4, "oke jadi yang mana diduganya memantannya ini kemarin itu ya"),
      seg(4.2, 8, "Kamu takut nggak sih kalau ketemu mantan lagi?"),
    ];
    const h = localHookLine("yang mana diduganya memantannya ini", segs, 0, 30);
    expect(h.split(" ").length).toBeLessThanOrEqual(9);
    expect(h).toMatch(/^[A-Z]/);
    expect(h).toMatch(/mantan/i);
  });

  it("sanitizes AI hooks", () => {
    expect(sanitizeHook('"ternyata dia selama ini bohong soal semuanya ke aku dan keluarga besar"')).toMatch(/…$/);
    expect(sanitizeHook("kenapa dia pergi")).toBe("Kenapa dia pergi?");
  });
});

describe("card title", () => {
  it("turns a raw transcript fragment into a whole cleaned sentence", () => {
    const segs = [
      seg(0, 3, "Kayaknya lumayan apa ya?"),
      seg(3.2, 9, "Jadi aku tuh baru sadar kalau kerja keras aja nggak cukup buat sukses."),
      seg(9.2, 14, "Dan terus yang itu tadi juga gitu sih."),
    ];
    const t = localTitle("Kayaknya lumayan apa ya?", segs, 0, 30);
    expect(t).toMatch(/^[A-Z]/);
    expect(t.split(" ").length).toBeLessThanOrEqual(12);
    expect(t.length).toBeLessThanOrEqual(64);
    expect(t).toMatch(/kerja keras/);
    expect(t).not.toMatch(/…$/);
    expect(t).not.toMatch(/^Kayaknya lumayan/);
  });

  it("sanitizes AI titles", () => {
    expect(sanitizeTitle('"Kenapa kerja keras aja nggak cukup #motivasi 🔥"')).toBe("Kenapa kerja keras aja nggak cukup?");
    const long = sanitizeTitle("Cerita panjang tentang bagaimana seseorang akhirnya berhasil keluar dari utang besar dalam lima tahun");
    expect(long.length).toBeLessThanOrEqual(66);
    expect(long).toMatch(/…$/);
  });
});
