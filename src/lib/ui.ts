import type { StudioStatus, ViralityGrades } from "./types";

export function statusTone(status: StudioStatus | string) {
  if (status === "ready") return "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/25";
  if (status === "error") return "bg-red-500/15 text-red-300 ring-1 ring-red-500/25";
  if (status === "queued") return "bg-zinc-500/15 text-zinc-300 ring-1 ring-zinc-500/25";
  return "bg-sky-500/15 text-sky-200 ring-1 ring-sky-500/25";
}

export function isBusyStatus(status: string) {
  return ["queued", "downloading", "transcribing", "clipping", "rendering"].includes(status);
}

export function formatDuration(sec?: number) {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}:${String(r).padStart(2, "0")}` : `0:${String(r).padStart(2, "0")}`;
}

export function formatClock(sec: number) {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 10);
  return `${m}:${String(r).padStart(2, "0")}.${ms}`;
}

export function viralityScore(score: number) {
  return Math.max(0, Math.min(99, Math.round(score * 99)));
}

export function scoreLabel(score: number) {
  return String(viralityScore(score));
}

export function gradeLetter(n: number) {
  if (n >= 0.85) return "A";
  if (n >= 0.75) return "A-";
  if (n >= 0.65) return "B+";
  if (n >= 0.55) return "B";
  if (n >= 0.45) return "B-";
  if (n >= 0.35) return "C+";
  return "C";
}

export function gradeBars(grades?: ViralityGrades) {
  return [
    { key: "Hook", value: grades?.hook ?? 0 },
    { key: "Flow", value: grades?.flow ?? 0 },
    { key: "Value", value: grades?.value ?? 0 },
    { key: "Trend", value: grades?.trend ?? 0 },
  ] as const;
}

export function stageLabel(status: string) {
  switch (status) {
    case "queued":
      return "Antre";
    case "downloading":
      return "Mengunduh video";
    case "transcribing":
      return "Transkripsi";
    case "clipping":
      return "Cari momen";
    case "rendering":
      return "Render clip";
    case "ready":
      return "Siap";
    case "error":
      return "Berhenti / gagal";
    default:
      return status;
  }
}


export function formatRelativeTime(iso?: string) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = Date.now() - t;
  const sec = Math.round(diff / 1000);
  if (sec < 45) return "baru saja";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} mnt lalu`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} jam lalu`;
  const day = Math.round(hr / 24);
  if (day < 14) return `${day} hari lalu`;
  return new Date(iso).toLocaleDateString("id-ID", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export type ScoreInfo = {
  value: number;
  source: "ai" | "local" | "legacy";
  label: string;
  parts: { key: string; label: string; value: number }[];
  reasons: string[];
  model?: string;
  tooltip: string;
};

/** One place that decides what score to show and how honest it is. */
export function clipScoreInfo(c: {
  score: number;
  scoring?: import("./types").ClipScoring;
  grades?: ViralityGrades;
}): ScoreInfo {
  if (c.scoring) {
    const p = c.scoring.parts;
    const parts = [
      { key: "hook", label: "Hook", value: p.hook },
      { key: "emotion", label: "Emosi", value: p.emotion },
      { key: "payoff", label: "Payoff", value: p.payoff },
      { key: "clarity", label: "Jelas", value: p.clarity },
    ];
    const label = c.scoring.source === "ai" ? "Skor AI" : "Estimasi lokal";
    return {
      value: c.scoring.score,
      source: c.scoring.source,
      label,
      parts,
      reasons: c.scoring.reasons,
      model: c.scoring.model,
      tooltip: `${label}${c.scoring.model ? ` (${c.scoring.model})` : ""}: ${c.scoring.score}/100\n${parts
        .map((x) => `${x.label} ${x.value}/10`)
        .join(" · ")}${c.scoring.reasons.length ? `\n• ${c.scoring.reasons.join("\n• ")}` : ""}`,
    };
  }
  const g = c.grades;
  return {
    value: viralityScore(c.score),
    source: "legacy",
    label: "Skor lama (belum dikalibrasi)",
    parts: g
      ? [
          { key: "hook", label: "Hook", value: Math.round(g.hook * 100) / 10 },
          { key: "flow", label: "Flow", value: Math.round(g.flow * 100) / 10 },
          { key: "value", label: "Value", value: Math.round(g.value * 100) / 10 },
          { key: "trend", label: "Trend", value: Math.round(g.trend * 100) / 10 },
        ]
      : [],
    reasons: [],
    tooltip: "Skor lama (rumus keyword, cenderung 95–99). Re-render untuk skor baru.",
  };
}
