"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Switch } from "@/components/Switch";
import { parseModel } from "@/lib/model-catalog";
import {
  CLIP_LENGTH_PRESETS,
  GENRE_PRESETS,
  type AspectRatio,
  type SkillPacks,
  type SourceKind,
} from "@/lib/types";

/* ───────────────────────── icons ───────────────────────── */

type IconProps = { className?: string };
export const Icon = {
  youtube: ({ className = "h-4 w-4" }: IconProps) => (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M21.6 7.2a2.5 2.5 0 0 0-1.76-1.77C18.25 5 12 5 12 5s-6.25 0-7.84.43A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.76 1.77C5.75 19 12 19 12 19s6.25 0 7.84-.43a2.5 2.5 0 0 0 1.76-1.77A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8ZM10 15V9l5.2 3L10 15Z" />
    </svg>
  ),
  tiktok: ({ className = "h-4 w-4" }: IconProps) => (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 0 1-2.59 2.5 2.6 2.6 0 0 1-2.59-2.6 2.6 2.6 0 0 1 3.39-2.47V9.68a5.73 5.73 0 0 0-.8-.06 5.7 5.7 0 0 0-5.7 5.7A5.7 5.7 0 0 0 9.86 21a5.7 5.7 0 0 0 5.7-5.7V9.01a7.35 7.35 0 0 0 4.29 1.37V7.29a4.29 4.29 0 0 1-3.25-1.47Z" />
    </svg>
  ),
  upload: ({ className = "h-4 w-4" }: IconProps) => (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
    </svg>
  ),
  sliders: ({ className = "h-4 w-4" }: IconProps) => (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8M14 4.5v5M8 14.5v5" />
    </svg>
  ),
  chevron: ({ className = "h-4 w-4" }: IconProps) => (
    <svg viewBox="0 0 20 20" className={className} fill="currentColor" aria-hidden>
      <path d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" />
    </svg>
  ),
  sparkle: ({ className = "h-4 w-4" }: IconProps) => (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9L12 2.5Zm6.5 12 .9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6Z" />
    </svg>
  ),
  arrowRight: ({ className = "h-4 w-4" }: IconProps) => (
    <svg viewBox="0 0 20 20" className={className} fill="currentColor" aria-hidden>
      <path fillRule="evenodd" d="M3 10a.75.75 0 0 1 .75-.75h10.64l-3.97-3.97a.75.75 0 1 1 1.06-1.06l5.25 5.25a.75.75 0 0 1 0 1.06l-5.25 5.25a.75.75 0 1 1-1.06-1.06l3.97-3.97H3.75A.75.75 0 0 1 3 10Z" clipRule="evenodd" />
    </svg>
  ),
  check: ({ className = "h-3 w-3" }: IconProps) => (
    <svg viewBox="0 0 20 20" className={className} fill="currentColor" aria-hidden>
      <path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.79 6.8-6.79a1 1 0 0 1 1.4 0Z" clipRule="evenodd" />
    </svg>
  ),
};

/* ───────────────────────── source tabs ───────────────────────── */

export const SOURCES: { id: SourceKind; label: string; icon: keyof typeof Icon }[] = [
  { id: "youtube", label: "YouTube", icon: "youtube" },
  { id: "tiktok", label: "TikTok", icon: "tiktok" },
  { id: "upload", label: "Upload", icon: "upload" },
];

export function SourceTabs({ value, onChange }: { value: SourceKind; onChange: (v: SourceKind) => void }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const idx = SOURCES.findIndex((s) => s.id === value);
  function onKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = (idx + (e.key === "ArrowRight" ? 1 : SOURCES.length - 1)) % SOURCES.length;
    onChange(SOURCES[next].id);
    refs.current[next]?.focus();
  }
  return (
    <div
      role="radiogroup"
      aria-label="Sumber video"
      onKeyDown={onKey}
      className="relative inline-grid grid-cols-3 rounded-2xl border border-white/[0.08] bg-black/40 p-1"
    >
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.10] shadow-[0_0_24px_-6px_rgba(52,211,153,0.45)] transition-transform duration-200 ease-out"
        style={{ width: "calc((100% - 0.5rem) / 3)", transform: `translateX(${idx * 100}%)` }}
      />
      {SOURCES.map((s, i) => {
        const on = s.id === value;
        const I = Icon[s.icon];
        return (
          <button
            key={s.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(s.id)}
            className={`relative z-10 flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40 sm:px-6 ${
              on ? "text-emerald-100" : "text-zinc-500 hover:text-zinc-200"
            }`}
          >
            <I className={`h-4 w-4 ${on ? "text-emerald-300" : ""}`} />
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

/* ───────────────────────── options data ───────────────────────── */

const ASPECTS: { id: AspectRatio; label: string; hint: string; w: number; h: number }[] = [
  { id: "9:16", label: "9:16", hint: "Reels · Shorts · TikTok", w: 18, h: 32 },
  { id: "1:1", label: "1:1", hint: "Feed IG / FB", w: 26, h: 26 },
  { id: "16:9", label: "16:9", hint: "YouTube landscape", w: 36, h: 20 },
];

const DURATION_HINT: Record<string, string> = {
  auto: "AI pilih durasi clip",
  short: "Clip pendek, hook di detik awal",
  mid: "Paling umum dipakai",
  long: "Cerita/penjelasan utuh",
};

const GENRE_META: Record<string, { short: string; hint: string }> = {
  podcast: { short: "Podcast", hint: "Obrolan, curhat, wawancara" },
  education: { short: "Edukasi", hint: "Tips, tutorial, penjelasan" },
  story: { short: "Story", hint: "Konflik, emosi, plot twist" },
  entertainment: { short: "Hiburan", hint: "Lucu, reaksi, momen seru" },
  general: { short: "General", hint: "Campuran / tidak yakin" },
};

type SkillKey = "smartCover" | "smartHook" | "autoReframe" | "captions";
const SKILLS: { key: SkillKey; title: string; desc: string; affects: string }[] = [
  {
    key: "autoReframe",
    title: "Auto reframe",
    desc: "Ikuti wajah per shot, split 2 orang otomatis",
    affects: "Framing",
  },
  {
    key: "captions",
    title: "Captions",
    desc: "Subtitle per kata, posisi aman dari wajah",
    affects: "Subtitle",
  },
  {
    key: "smartHook",
    title: "Smart hook",
    desc: "Judul hook muncul di 3 detik pertama",
    affects: "Intro clip",
  },
  {
    key: "smartCover",
    title: "Smart cover",
    desc: "Thumbnail dari frame yang dipilih + judul",
    affects: "Cover",
  },
];

export function optionsSummary(o: { exportAspect: AspectRatio; targetSec: number; genre: string; skills: SkillPacks }) {
  const dur = CLIP_LENGTH_PRESETS.find((p) => p.targetSec === o.targetSec);
  const durLabel = dur ? (dur.id === "auto" ? "Auto" : dur.label) : `${o.targetSec}s`;
  const g = GENRE_META[o.genre]?.short || GENRE_PRESETS.find((x) => x.id === o.genre)?.label || o.genre;
  const n = SKILLS.filter((s) => o.skills[s.key]).length;
  return [o.exportAspect, durLabel, g, `${n} skill`];
}

/* ───────────────────────── disclosure ───────────────────────── */

export function AdvancedToggle({
  open,
  onToggle,
  summary,
}: {
  open: boolean;
  onToggle: () => void;
  summary: string[];
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls="advanced-options"
      className={`group mx-auto flex w-full max-w-xl items-center gap-3 rounded-2xl border px-4 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-400/15 ${
        open
          ? "border-emerald-400/25 bg-emerald-400/[0.05]"
          : "border-white/[0.07] bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]"
      }`}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
          open ? "bg-emerald-400/15 text-emerald-300" : "bg-white/5 text-zinc-400 group-hover:text-zinc-200"
        }`}
      >
        <Icon.sliders />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-zinc-200">Opsi lanjutan</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-zinc-500">
          {summary.map((s, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-zinc-700">·</span>}
              <span className={i === 0 ? "font-mono text-zinc-400" : ""}>{s}</span>
            </span>
          ))}
        </span>
      </span>
      <span className="hidden text-xs text-zinc-500 sm:inline">{open ? "Tutup" : "Atur"}</span>
      <Icon.chevron className={`h-4 w-4 text-zinc-500 transition ${open ? "rotate-180 text-emerald-300" : ""}`} />
    </button>
  );
}

/* ───────────────────────── panel ───────────────────────── */

function SectionLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{children}</p>
      {hint && <p className="text-[11px] text-zinc-600">{hint}</p>}
    </div>
  );
}

const optionCard = (on: boolean) =>
  `relative rounded-2xl border text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-400/15 ${
    on
      ? "border-emerald-400/50 bg-emerald-400/[0.07] ring-1 ring-emerald-400/20"
      : "border-white/[0.07] bg-black/25 hover:border-white/15 hover:bg-white/[0.03]"
  }`;

export function AdvancedPanel(props: {
  title: string;
  setTitle: (v: string) => void;
  exportAspect: AspectRatio;
  setExportAspect: (v: AspectRatio) => void;
  targetSec: number;
  setTargetSec: (v: number) => void;
  genre: string;
  setGenre: (v: string) => void;
  skills: SkillPacks;
  setSkills: (fn: (s: SkillPacks) => SkillPacks) => void;
}) {
  const { exportAspect, targetSec, genre, skills } = props;
  return (
    <div id="advanced-options" className="panel mt-3 space-y-6 p-4 text-left sm:p-6">
      {/* Judul */}
      <div>
        <SectionLabel hint="opsional">Judul studio</SectionLabel>
        <input
          value={props.title}
          onChange={(e) => props.setTitle(e.target.value)}
          placeholder="Otomatis dari judul video"
          className="input"
        />
      </div>

      {/* Format + durasi */}
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <SectionLabel>Format</SectionLabel>
          <div role="radiogroup" aria-label="Aspect ratio" className="grid grid-cols-3 gap-2">
            {ASPECTS.map((a) => {
              const on = exportAspect === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => props.setExportAspect(a.id)}
                  className={`${optionCard(on)} flex flex-col items-center px-2 pb-2.5 pt-3`}
                >
                  <span className="flex h-9 items-center justify-center">
                    <span
                      className={`rounded-[5px] border-2 transition ${
                        on ? "border-emerald-300 bg-emerald-400/20" : "border-zinc-600 bg-white/[0.03]"
                      }`}
                      style={{ width: a.w, height: a.h }}
                    />
                  </span>
                  <span className={`mt-2 font-mono text-sm font-semibold ${on ? "text-emerald-100" : "text-zinc-200"}`}>
                    {a.label}
                  </span>
                  <span className="mt-0.5 text-center text-[10.5px] leading-tight text-zinc-500">{a.hint}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <SectionLabel hint={DURATION_HINT[CLIP_LENGTH_PRESETS.find((p) => p.targetSec === targetSec)?.id || "auto"]}>
            Durasi clip
          </SectionLabel>
          <div role="radiogroup" aria-label="Durasi clip" className="grid grid-cols-2 gap-2">
            {CLIP_LENGTH_PRESETS.map((p) => {
              const on = targetSec === p.targetSec;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  title={DURATION_HINT[p.id]}
                  onClick={() => props.setTargetSec(p.targetSec)}
                  className={`${optionCard(on)} flex items-center justify-between gap-2 px-3.5 py-3`}
                >
                  <span className={`text-sm font-semibold ${on ? "text-emerald-100" : "text-zinc-200"}`}>
                    {p.id === "auto" ? "Auto" : p.label}
                  </span>
                  <span className={`font-mono text-[11px] ${on ? "text-emerald-300/80" : "text-zinc-500"}`}>
                    {p.id === "auto" ? "20–60s" : `~${p.targetSec}s`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Genre */}
      <div>
        <SectionLabel hint="bantu AI cari momen yang pas">Genre konten</SectionLabel>
        <div role="radiogroup" aria-label="Genre" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {GENRE_PRESETS.map((g) => {
            const on = genre === g.id;
            const meta = GENRE_META[g.id] || { short: g.label, hint: "" };
            return (
              <button
                key={g.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => props.setGenre(g.id)}
                className={`${optionCard(on)} px-3 py-2.5`}
              >
                <span className={`block truncate text-sm font-semibold ${on ? "text-emerald-100" : "text-zinc-200"}`}>
                  {meta.short}
                </span>
                <span className="mt-1 block text-[10.5px] leading-tight text-zinc-500">{meta.hint}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Skills */}
      <div>
        <SectionLabel hint={`${SKILLS.filter((s) => skills[s.key]).length}/4 aktif`}>Skill packs</SectionLabel>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {SKILLS.map((s) => {
            const on = skills[s.key];
            const toggle = () => props.setSkills((cur) => ({ ...cur, [s.key]: !cur[s.key] }));
            return (
              <div
                key={s.key}
                onClick={toggle}
                className={`${optionCard(on)} flex cursor-pointer items-center gap-3 p-3.5`}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={`text-sm font-semibold ${on ? "text-zinc-50" : "text-zinc-300"}`}>{s.title}</span>
                    <span className="rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[10px] leading-none text-zinc-400">
                      {s.affects}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs text-zinc-500">{s.desc}</span>
                </span>
                <Switch size="sm" checked={on} onChange={toggle} label={s.title} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── AI chip ───────────────────────── */

export function AiModelChip() {
  const [state, setState] = useState<{ model: string; enabled: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/settings")
      .then((r) => r.json())
      .then((j) => {
        if (alive && j?.data) setState({ model: j.data.model || "", enabled: Boolean(j.data.enabled) });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!state) return <span className="inline-block h-7 w-40 animate-pulse rounded-full bg-white/[0.04]" />;
  const active = state.enabled && state.model;
  if (active) {
    const info = parseModel({ id: state.model });
    return (
      <Link
        href="/settings"
        className="group inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/[0.06] py-1 pl-2 pr-3 text-xs text-emerald-100 transition hover:border-emerald-400/40"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
          <Icon.sparkle className="h-3 w-3" />
        </span>
        AI ranking · <span className="font-semibold">{info.name}</span>
        <span className="font-mono text-[10px] text-emerald-300/60">{info.provider}</span>
        <Icon.arrowRight className="h-3 w-3 text-emerald-300/50 transition group-hover:translate-x-0.5 group-hover:text-emerald-300" />
      </Link>
    );
  }
  return (
    <Link
      href="/settings"
      className="group inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/[0.06] py-1 pl-2 pr-3 text-xs text-amber-100 transition hover:border-amber-300/40"
    >
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-300/15 text-[11px] text-amber-200">!</span>
      Ranking lokal · <span className="font-semibold">pilih model AI</span>
      <Icon.arrowRight className="h-3 w-3 text-amber-200/50 transition group-hover:translate-x-0.5" />
    </Link>
  );
}
