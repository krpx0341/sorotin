/**
 * Display titles for studios: YouTube titles are often ALL CAPS, emoji-laden and
 * clickbaity ("DISVMPAHI… AYAH⁉️ “AKU BUTUH PERTOLONGAN‼️”"). This makes a calm,
 * readable version without an LLM. Client-safe (no node imports).
 */

const EMOJI_PUNCT: Array<[RegExp, string]> = [
  [/[⁉❓❔]\uFE0F?/gu, "?"],
  [/[‼❗❕]\uFE0F?/gu, "!"],
];
const PICTO = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\uFE0F\u200D\u20E3]/gu;
const LOWER_WORDS = new Set(
  "di ke dari dan yang untuk atau dengan pada dalam oleh jadi sama buat vs of the and a an to in on at for or with by".split(" "),
);
/** Short tokens that are real acronyms and should stay upper-case. */
const ACRONYMS = new Set(
  "AI TV SMA SMP SD SMK KPK DPR MPR TNI POLRI BPJS UMKM PNS ASN UI ITB UGM CEO HRD USA UK RI DKI NTT NTB DIY PDIP PKS CCTV OTT KDRT SIM KTP KK".split(" "),
);
export const STUDIO_TITLE_MAX = 100;

function isMostlyUpper(t: string): boolean {
  const letters = t.replace(/[^\p{L}]/gu, "");
  if (letters.length < 6) return false;
  const upper = letters.replace(/[^\p{Lu}]/gu, "").length;
  return upper / letters.length > 0.6;
}

function titleCaseWord(w: string, first: boolean): string {
  const bare = w.replace(/[^\p{L}\p{N}]/gu, "");
  if (ACRONYMS.has(bare.toUpperCase()) && bare === bare.toUpperCase()) return w;
  const lower = w.toLocaleLowerCase("id");
  if (!first && LOWER_WORDS.has(lower.replace(/[^\p{L}]/gu, ""))) return lower;
  const i = lower.search(/\p{L}/u);
  return i < 0 ? lower : lower.slice(0, i) + lower.charAt(i).toLocaleUpperCase("id") + lower.slice(i + 1);
}

export function cleanStudioTitle(raw: string | undefined | null): string {
  let t = String(raw || "");
  for (const [re, rep] of EMOJI_PUNCT) t = t.replace(re, rep);
  t = t
    .replace(PICTO, " ")
    .replace(/[“”„«»"]/g, " ")
    .replace(/#[\p{L}\p{N}_]+/gu, " ")
    .replace(/\s+([?!.,:;])/g, "$1")
    .replace(/([?!])\1+/g, "$1")
    .replace(/\s*[|│]\s*/g, " · ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-–—·,:;\s]+|[-–—·,:;\s]+$/g, "");
  if (isMostlyUpper(t)) {
    let first = true;
    t = t
      .split(" ")
      .map((w) => {
        const out = titleCaseWord(w, first);
        first = /[?!.:]$/.test(w);
        return out;
      })
      .join(" ");
  }
  if (t.length > STUDIO_TITLE_MAX) {
    t = t.slice(0, STUDIO_TITLE_MAX + 1).split(" ").slice(0, -1).join(" ").replace(/[-–—·,:;\s]+$/, "") + "…";
  }
  return t || "Project tanpa judul";
}

/** What the UI shows: AI/user display title, else the cleaned original. */
export function studioDisplayTitle(s: { title: string; displayTitle?: string }): string {
  return s.displayTitle?.trim() || cleanStudioTitle(s.title);
}
