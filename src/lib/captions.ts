import type { TranscriptSegment } from "./types";

const EMPHASIS_RE =
  /viral|tips|cara|rahasia|penting|jangan|ternyata|akhirnya|shock|gila|wow|must|never|secret|hack|why|how|mistake|warning|stop|wait|listen|best|worst|bongkar|fakta|hati-hati|wajib|langsung|diet|turun|kg|bulan|jujur|cerita|banget|sekali|parah|gokil|serius|coba|tunggu|fun|fact|sampai|ngaku|selingkuh|suami|istri/i;

export type CaptionWord = { start: number; end: number; word: string };

/** Bold display font burned into ASS (must exist on host). */
export const CAPTION_FONT = "Noto Sans Black";
export const CAPTION_FONT_DIR = "/usr/share/fonts/noto";

function assTime(sec: number) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  const whole = Math.floor(rem);
  const cs = Math.round((rem - whole) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(whole).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function escapeAss(text: string) {
  return text.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}");
}

function wordKey(word: string) {
  return word.replace(/[^\p{L}\p{N}]+/gu, "");
}

function toDisplayWord(word: string) {
  const cleaned = word.trim();
  if (!cleaned) return "";
  return cleaned.toLocaleUpperCase("id-ID");
}

/** Expand segments into words; invent linear timings when Whisper words missing. */
export function wordsForClip(
  segments: TranscriptSegment[],
  clipStart: number,
  clipEnd: number,
): CaptionWord[] {
  const out: CaptionWord[] = [];
  for (const seg of segments) {
    if (seg.end < clipStart || seg.start > clipEnd) continue;
    if (seg.words?.length) {
      for (const w of seg.words) {
        if (w.end < clipStart || w.start > clipEnd) continue;
        out.push({
          start: Math.max(clipStart, w.start),
          end: Math.min(clipEnd, w.end),
          word: w.word,
        });
      }
      continue;
    }
    const tokens = seg.text.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const a = Math.max(clipStart, seg.start);
    const b = Math.min(clipEnd, seg.end);
    const span = Math.max(0.05, b - a);
    tokens.forEach((word, i) => {
      const start = a + (span * i) / tokens.length;
      const end = a + (span * (i + 1)) / tokens.length;
      out.push({ start, end, word });
    });
  }
  return out;
}

function chunkWords(words: CaptionWord[], maxWords = 3): CaptionWord[][] {
  const chunks: CaptionWord[][] = [];
  let buf: CaptionWord[] = [];
  for (const w of words) {
    buf.push(w);
    const punct = /[.!?…,;:]$/.test(w.word.trim());
    // Prefer punchy 2-word lines; allow 3 on long tokens.
    const long = buf.reduce((n, x) => n + x.word.length, 0) >= 18;
    if (buf.length >= maxWords || punct || (buf.length >= 2 && long)) {
      chunks.push(buf);
      buf = [];
    }
  }
  if (buf.length) chunks.push(buf);
  return chunks;
}

/**
 * OpusClip-like ASS: 2–3 words, ALL CAPS, thick outline + shadow,
 * active spoken word pops yellow (scale + color).
 */
export function captionFontSize(playResY: number) {
  return Math.round(playResY * 0.058);
}

export function defaultCaptionMarginV(playResY: number) {
  // Alignment 2 = bottom-center; MarginV lifts toward mid/lower chest.
  return Math.round(playResY * 0.24);
}

/** Height (0..1 of frame) of a caption block of `lines` lines incl. the active-word pop. */
export function captionBandHeight(playResY: number, lines = 2) {
  return (captionFontSize(playResY) * 1.18 * 1.22 * lines) / playResY;
}

export type CaptionPlacementSpan = { start: number; end: number; marginV: number };

/** Split [start,end) across placement spans → [{start,end,marginV}] (marginV 0 = style default). */
export function splitByPlacement(
  start: number,
  end: number,
  placements: CaptionPlacementSpan[] | undefined,
): Array<{ start: number; end: number; marginV: number }> {
  if (!placements?.length) return [{ start, end, marginV: 0 }];
  const out: Array<{ start: number; end: number; marginV: number }> = [];
  for (const p of placements) {
    const a = Math.max(start, p.start);
    const b = Math.min(end, p.end);
    if (b - a > 0.005) out.push({ start: a, end: b, marginV: p.marginV });
  }
  if (!out.length) out.push({ start, end, marginV: 0 });
  return out;
}

export function buildAssCaptions(opts: {
  words: CaptionWord[];
  playResX: number;
  playResY: number;
  clipStart: number;
  /** Per-shot vertical placement (clip-relative seconds). */
  placements?: CaptionPlacementSpan[];
}): string {
  const { words, playResX, playResY, clipStart, placements } = opts;
  const rel = (t: number) => Math.max(0, t - clipStart);
  const chunks = chunkWords(words, 3);
  const events: string[] = [];

  const white = "&H00FFFFFF&";
  const dim = "&H00E8E8E8&";
  // ASS colour = &HAABBGGRR&
  const yellow = "&H0000F5FF&"; // bright gold-yellow
  const hot = "&H00008CFF&"; // orange-hot for emphasis keywords

  for (const chunk of chunks) {
    if (!chunk.length) continue;
    for (let i = 0; i < chunk.length; i++) {
      const active = chunk[i];
      const start = rel(active.start);
      const end = rel(Math.max(active.end, active.start + 0.12));
      if (end - start < 0.05) continue;
      const text = chunk
        .map((w, j) => {
          const token = escapeAss(toDisplayWord(w.word));
          if (!token) return "";
          if (j === i) {
            const color = EMPHASIS_RE.test(wordKey(w.word)) ? hot : yellow;
            // Pop: bold + scale + slight blur edge
            return `{\\c${color}\\b1\\fscx118\\fscy118\\bord5}${token}{\\c${white}\\b0\\fscx100\\fscy100\\bord4}`;
          }
          return `{\\c${dim}\\b0\\fscx100\\fscy100}${token}`;
        })
        .filter(Boolean)
        .join(" ");
      // An event crossing a shot boundary is split so each part uses that shot's position.
      for (const part of splitByPlacement(start, end, placements)) {
        events.push(
          `Dialogue: 0,${assTime(part.start)},${assTime(part.end)},Caption,,0,0,${part.marginV},,${text}`,
        );
      }
    }
  }

  const fontSize = captionFontSize(playResY);
  const marginV = defaultCaptionMarginV(playResY);
  const marginLR = Math.round(playResX * 0.06);

  return `[Script Info]
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: ${playResX}
PlayResY: ${playResY}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,${CAPTION_FONT},${fontSize},&H00FFFFFF,&H0000FFFF,&H00000000,&H64000000,-1,0,0,0,100,100,1.2,0,1,5,3,2,${marginLR},${marginLR},${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join("\n")}
`;
}
