"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  FAMILY_ORDER,
  fuzzyScore,
  hideViaDuplicates,
  sortModels,
  type ModelFamily,
  type ModelInfo,
  type ModelTag,
} from "@/lib/model-catalog";

const FAMILY_DOT: Record<ModelFamily, string> = {
  Claude: "bg-orange-300",
  GPT: "bg-emerald-300",
  Gemini: "bg-sky-300",
  Grok: "bg-zinc-200",
  DeepSeek: "bg-indigo-300",
  Qwen: "bg-violet-300",
  Kimi: "bg-cyan-300",
  GLM: "bg-blue-300",
  MiniMax: "bg-rose-300",
  MiMo: "bg-amber-300",
  Gemma: "bg-teal-300",
  NVIDIA: "bg-lime-300",
  Combo: "bg-fuchsia-300",
  Lainnya: "bg-zinc-500",
};

const TAG_STYLE: Partial<Record<ModelTag, string>> = {
  thinking: "border-violet-400/30 bg-violet-400/10 text-violet-200",
  free: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  cepat: "border-sky-400/30 bg-sky-400/10 text-sky-200",
  "1M": "border-amber-400/30 bg-amber-400/10 text-amber-200",
};

export function FamilyDot({ family }: { family: ModelFamily }) {
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${FAMILY_DOT[family]}`} />;
}

export function ProviderBadge({ m }: { m: ModelInfo }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] leading-none text-zinc-300">
      {m.provider}
      {m.via ? <span className="text-zinc-500">· via {m.via}</span> : null}
    </span>
  );
}

export function TagChips({ tags, max = 4 }: { tags: ModelTag[]; max?: number }) {
  return (
    <>
      {tags.slice(0, max).map((t) => (
        <span
          key={t}
          className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none ${
            TAG_STYLE[t] || "border-white/10 bg-white/[0.03] text-zinc-400"
          }`}
        >
          {t}
        </span>
      ))}
    </>
  );
}

type Props = {
  models: ModelInfo[];
  value: string;
  onChange: (id: string) => void;
  loading?: boolean;
  disabled?: boolean;
};

export function ModelPicker({ models, value, onChange, loading, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<ModelFamily | "Semua">("Semua");
  const [showVia, setShowVia] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = models.find((m) => m.id === value);
  const chatModels = useMemo(() => models.filter((m) => m.chat || m.id === value), [models, value]);
  const base = useMemo(() => (showVia ? chatModels : hideViaDuplicates(chatModels)), [chatModels, showVia]);
  const viaHidden = chatModels.length - base.length;

  const familyCounts = useMemo(() => {
    const c = new Map<ModelFamily, number>();
    for (const m of base) c.set(m.family, (c.get(m.family) || 0) + 1);
    return FAMILY_ORDER.filter((f) => c.get(f)).map((f) => [f, c.get(f)!] as const);
  }, [base]);

  const filtered = useMemo(() => {
    const pool = family === "Semua" ? base : base.filter((m) => m.family === family);
    const ordered = sortModels(pool);
    if (!query.trim()) return ordered;
    // Stable sort keeps the natural order (newest version, preferred route) among equal scores.
    return ordered
      .map((m) => ({ m, s: fuzzyScore(query, m) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.m);
  }, [base, family, query]);

  // Group (keeps search ranking order inside each group; groups ordered by best hit).
  const groups = useMemo(() => {
    const map = new Map<ModelFamily, ModelInfo[]>();
    for (const m of filtered) {
      if (!map.has(m.family)) map.set(m.family, []);
      map.get(m.family)!.push(m);
    }
    return [...map.entries()];
  }, [filtered]);
  const flat = useMemo(() => groups.flatMap(([, list]) => list), [groups]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    const t = setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true });
      // Make room for the panel: bring the trigger near the top of the viewport.
      const r = rootRef.current?.getBoundingClientRect();
      if (r && r.bottom + 440 > window.innerHeight) {
        window.scrollBy({ top: r.top - 88, behavior: "smooth" });
      }
    }, 0);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      clearTimeout(t);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function openPicker() {
    if (disabled) return;
    const idx = flat.findIndex((m) => m.id === value);
    setActive(idx >= 0 ? idx : 0);
    setOpen(true);
  }

  function choose(m: ModelInfo) {
    onChange(m.id);
    setOpen(false);
    setQuery("");
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(flat.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "PageDown") {
      e.preventDefault();
      setActive((a) => Math.min(flat.length - 1, a + 8));
    } else if (e.key === "PageUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 8));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (flat[active]) choose(flat[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  let idx = -1;
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openPicker())}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            openPicker();
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`group flex w-full items-center gap-3 rounded-2xl border bg-black/40 px-4 py-3 text-left transition ${
          open
            ? "border-emerald-400/50 ring-4 ring-emerald-400/10"
            : "border-white/10 hover:border-white/20 hover:bg-black/50"
        } disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {selected ? (
          <>
            <FamilyDot family={selected.family} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-sm font-semibold text-zinc-50">{selected.name}</span>
                <ProviderBadge m={selected} />
                <TagChips tags={selected.tags} />
              </div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">{selected.id}</div>
            </div>
          </>
        ) : (
          <div className="min-w-0 flex-1">
            <div className="text-sm text-zinc-300">
              {loading ? "Memuat daftar model…" : value ? value : "Pilih model…"}
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500">
              {loading ? "Mengambil /models dari endpoint" : `${base.length} model tersedia · klik lalu ketik untuk cari`}
            </div>
          </div>
        )}
        <span className="flex items-center gap-2 text-zinc-500">
          <kbd className="hidden rounded-md border border-white/10 px-1.5 py-0.5 font-mono text-[10px] sm:inline">
            ↵
          </kbd>
          <svg
            className={`h-4 w-4 transition ${open ? "rotate-180 text-emerald-300" : "group-hover:text-zinc-300"}`}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden
          >
            <path d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" />
          </svg>
        </span>
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 z-50 mt-2 overflow-hidden rounded-2xl border border-white/10 bg-[#0d1311]/95 shadow-2xl shadow-black/60 ring-1 ring-emerald-400/10 backdrop-blur-xl"
          onKeyDown={onKey}
        >
          <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
            <svg className="h-4 w-4 shrink-0 text-zinc-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path
                fillRule="evenodd"
                d="M9 3.5a5.5 5.5 0 1 0 3.47 9.77l3.13 3.13a.75.75 0 1 0 1.06-1.06l-3.13-3.13A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z"
                clipRule="evenodd"
              />
            </svg>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              placeholder="Cari model… (mis. opus, gpt 6, flash free)"
              className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
              role="combobox"
              aria-expanded
              aria-controls="model-listbox"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} className="text-xs text-zinc-500 hover:text-zinc-300">
                hapus
              </button>
            )}
          </div>

          <div className="flex gap-1.5 overflow-x-auto border-b border-white/5 px-3 py-2">
            {(["Semua", ...familyCounts.map(([f]) => f)] as const).map((f) => {
              const count = f === "Semua" ? base.length : familyCounts.find(([x]) => x === f)?.[1];
              const on = family === f;
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => {
                    setFamily(f);
                    setActive(0);
                    inputRef.current?.focus();
                  }}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                    on
                      ? "bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-400/30"
                      : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                  }`}
                >
                  {f !== "Semua" && <FamilyDot family={f} />}
                  {f}
                  <span className="text-zinc-500">{count}</span>
                </button>
              );
            })}
          </div>

          <div ref={listRef} id="model-listbox" role="listbox" className="max-h-[min(22rem,52vh)] overflow-y-auto py-1">
            {flat.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-zinc-500">
                Tidak ada model cocok dengan “{query}”.
              </div>
            )}
            {groups.map(([fam, list]) => (
              <div key={fam}>
                <div className="sticky top-0 z-10 flex items-center gap-2 bg-[#0d1311]/95 px-4 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 backdrop-blur">
                  <FamilyDot family={fam} />
                  {fam}
                  <span className="font-normal normal-case tracking-normal text-zinc-600">{list.length}</span>
                </div>
                {list.map((m) => {
                  idx += 1;
                  const i = idx;
                  const isActive = i === active;
                  const isSel = m.id === value;
                  return (
                    <div
                      key={m.id}
                      data-idx={i}
                      role="option"
                      aria-selected={isSel}
                      onMouseEnter={() => setActive(i)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        choose(m);
                      }}
                      className={`mx-1.5 flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 ${
                        isActive ? "bg-white/[0.07]" : ""
                      }`}
                    >
                      <span className={`flex h-4 w-4 shrink-0 items-center justify-center ${isSel ? "text-emerald-300" : "text-transparent"}`}>
                        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
                          <path
                            fillRule="evenodd"
                            d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.79 6.8-6.79a1 1 0 0 1 1.4 0Z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={`text-sm ${isSel ? "font-semibold text-emerald-100" : "text-zinc-100"}`}>
                            {m.name}
                          </span>
                          <TagChips tags={m.tags} max={3} />
                        </div>
                        <div className="truncate font-mono text-[10.5px] text-zinc-600">{m.id}</div>
                      </div>
                      <ProviderBadge m={m} />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/5 bg-black/30 px-4 py-2 text-[11px] text-zinc-500">
            <span className="flex items-center gap-3">
              <span>
                <kbd className="font-mono text-zinc-400">↑↓</kbd> navigasi
              </span>
              <span>
                <kbd className="font-mono text-zinc-400">↵</kbd> pilih
              </span>
              <span>
                <kbd className="font-mono text-zinc-400">esc</kbd> tutup
              </span>
            </span>
            <span className="flex items-center gap-3">
              <span>{flat.length} model</span>
              {(viaHidden > 0 || showVia) && (
                <label className="flex cursor-pointer items-center gap-1.5 hover:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={showVia}
                    onChange={(e) => setShowVia(e.target.checked)}
                    className="accent-emerald-400"
                  />
                  rute duplikat{viaHidden > 0 ? ` (+${viaHidden})` : ""}
                </label>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
