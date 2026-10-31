import type { TranscriptSegment } from "./types";
import { wordsForClip } from "./captions";

function srtTime(sec: number) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const whole = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(whole).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function buildSrtForClip(
  segments: TranscriptSegment[],
  clipStart: number,
  clipEnd: number,
): string {
  const words = wordsForClip(segments, clipStart, clipEnd);
  const lines: string[] = [];
  const chunk = 6;
  let idx = 1;
  for (let i = 0; i < words.length; i += chunk) {
    const part = words.slice(i, i + chunk);
    if (!part.length) continue;
    const start = Math.max(0, part[0].start - clipStart);
    const end = Math.max(start + 0.05, part[part.length - 1].end - clipStart);
    lines.push(String(idx++));
    lines.push(`${srtTime(start)} --> ${srtTime(end)}`);
    lines.push(part.map((w) => w.word).join(" "));
    lines.push("");
  }
  return lines.join("\n");
}

export function downloadText(filename: string, content: string, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
