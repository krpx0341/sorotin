"use client";

import { useMemo, useState } from "react";
import { Select } from "@/components/Select";
import { Switch } from "@/components/Switch";
import { buildSrtForClip, downloadText } from "@/lib/export";
import type { RenderedClip, Studio } from "@/lib/types";
import {
  formatClock,
  formatDuration,
  clipScoreInfo,
} from "@/lib/ui";

type SortKey = "score" | "time" | "liked";
type ViewMode = "grid" | "list";

export function ClipWorkspace({
  studio,
  onPatchClip,
}: {
  studio: Studio;
  onPatchClip: (
    clipId: string,
    patch: { liked?: boolean | null; hidden?: boolean; title?: string; description?: string },
  ) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("score");
  const [view, setView] = useState<ViewMode>("grid");
  const [hideDisliked, setHideDisliked] = useState(true);
  // Unsaved edits per clip id. No entry = show the clip's stored value, so switching clips
  // or a re-render that renames a clip never needs an effect to resync local state.
  const [drafts, setDrafts] = useState<Record<string, { title?: string; desc?: string }>>({});
  const [saving, setSaving] = useState(false);
  const linuxDesktop =
    typeof document !== "undefined" &&
    document.documentElement.dataset.shell === "desktop" &&
    /Linux/i.test(navigator.userAgent);

  const clips = useMemo(() => {
    let list = studio.clips.filter((c) => !c.hidden);
    if (hideDisliked) list = list.filter((c) => c.liked !== false);
    list = [...list].sort((a, b) => {
      if (sort === "time") return a.start - b.start;
      if (sort === "liked") {
        const av = a.liked === true ? 2 : a.liked == null ? 1 : 0;
        const bv = b.liked === true ? 2 : b.liked == null ? 1 : 0;
        return bv - av || b.score - a.score;
      }
      return b.score - a.score;
    });
    return list;
  }, [studio.clips, sort, hideDisliked]);

  const selected =
    clips.find((c) => c.id === selectedId) || clips[0] || null;

  const draft = (selected && drafts[selected.id]) || {};
  const titleDraft = draft.title ?? selected?.title ?? "";
  const descDraft = draft.desc ?? (selected ? selected.description || selected.reason || "" : "");
  function editDraft(patch: { title?: string; desc?: string }) {
    if (!selected) return;
    const id = selected.id;
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  }

  function select(c: RenderedClip) {
    setSelectedId(c.id);
  }

  async function saveMeta() {
    if (!selected) return;
    const title = titleDraft.replace(/\s+/g, " ").trim();
    const description = descDraft.trim();
    const patch: { title?: string; description?: string } = {};
    if (title && title !== selected.title) patch.title = title;
    if (description !== (selected.description || selected.reason || "")) patch.description = description;
    const id = selected.id;
    if (Object.keys(patch).length) await onPatchClip(id, patch);
    // Drop the draft so the field shows the stored value (an emptied title is restored).
    setDrafts((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });
  }

  function exportSrt() {
    if (!selected || !studio.transcript) return;
    const srt = buildSrtForClip(studio.transcript, selected.start, selected.end);
    downloadText(`${selected.title || "clip"}.srt`, srt, "application/x-subrip");
  }

  function clipHref() {
    if (!selected) return null;
    return (
      selected.exportPaths?.[studio.exportAspect] ||
      selected.exportPaths?.["9:16"] ||
      selected.previewPath ||
      null
    );
  }

  function filesPathParam(href: string) {
    try {
      return new URL(href, window.location.origin).searchParams.get("path");
    } catch {
      return null;
    }
  }

  async function exportClip(play: boolean) {
    const href = clipHref();
    if (!selected || !href) return;
    const rel = filesPathParam(href);
    if (!rel) return;
    setSaving(true);
    try {
      const r = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: rel,
          filename: `${selected.title || selected.id}.mp4`,
          play,
        }),
      });
      if (r.ok) return;
      if (play) return;
      const res = await fetch(href);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${selected.title || selected.id}.mp4`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setSaving(false);
    }
  }

  if (!studio.clips.length) {
    return (
      <div className="panel border-dashed p-12 text-center text-sm text-zinc-500">
        Clip muncul setelah ranking & render selesai.
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">
            Clips{" "}
            <span className="text-sm font-normal tabular-nums text-zinc-500">
              {clips.length}
              {studio.clips.length !== clips.length ? ` / ${studio.clips.length}` : ""}
            </span>
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1 text-zinc-400">
              <Switch size="sm" checked={hideDisliked} onChange={setHideDisliked} label="Sembunyikan clip yang di-dislike" />
              <span>Sembunyikan dislike</span>
            </label>
            <Select<SortKey>
              label="Urutkan clip"
              prefix="Urutkan:"
              value={sort}
              onChange={setSort}
              align="right"
              className="w-[188px]"
              options={[
                { value: "score", label: "Skor tertinggi" },
                { value: "time", label: "Urutan video" },
                { value: "liked", label: "Disukai dulu" },
              ]}
            />
            <div className="flex rounded-lg border border-white/10 bg-black/30 p-0.5" role="group" aria-label="Tampilan">
              {(["grid", "list"] as ViewMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setView(m)}
                  aria-pressed={view === m}
                  title={m === "grid" ? "Grid" : "List"}
                  className={`flex h-7 w-8 items-center justify-center rounded-md transition ${
                    view === m ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {m === "grid" ? (
                    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
                      <rect x="2" y="2" width="5" height="5" rx="1.2" fill="currentColor" />
                      <rect x="9" y="2" width="5" height="5" rx="1.2" fill="currentColor" />
                      <rect x="2" y="9" width="5" height="5" rx="1.2" fill="currentColor" />
                      <rect x="9" y="9" width="5" height="5" rx="1.2" fill="currentColor" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
                      <rect x="2" y="2.5" width="12" height="3" rx="1" fill="currentColor" />
                      <rect x="2" y="6.5" width="12" height="3" rx="1" fill="currentColor" />
                      <rect x="2" y="10.5" width="12" height="3" rx="1" fill="currentColor" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {clips.length === 0 ? (
          <div className="panel border-dashed p-10 text-center text-sm text-zinc-500">
            Semua clip disembunyikan. Matikan &ldquo;Sembunyikan dislike&rdquo; untuk melihatnya lagi.
          </div>
        ) : view === "grid" ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {clips.map((c) => {
              const active = selected?.id === c.id;
              const info = clipScoreInfo(c);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => select(c)}
                    aria-pressed={active}
                    className={`group panel block w-full overflow-hidden text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 ${
                      active ? "ring-2 ring-emerald-400/60" : "hover:border-white/20"
                    } ${c.liked === false ? "opacity-60" : ""}`}
                  >
                    <div className="relative aspect-[9/16] w-full overflow-hidden bg-black">
                      {c.coverPath ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={c.coverPath}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                        />
                      ) : (
                        <ClipPlaceholder status={c.status} />
                      )}
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent" />
                      <ScoreBadge info={info} />
                      {c.liked === true && (
                        <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-400 text-[11px] text-[#04241a]" title="Disukai">
                          ♥
                        </span>
                      )}
                      <span className="absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-zinc-100">
                        {formatDuration(c.end - c.start)}
                      </span>
                    </div>
                    <div className="space-y-1 p-2.5">
                      <p className="line-clamp-2 min-h-[2.5em] text-[13px] font-semibold leading-snug text-zinc-100">{c.title}</p>
                      <p className="text-[11px] tabular-nums text-zinc-500">
                        {formatClock(c.start)} → {formatClock(c.end)}
                      </p>
                      {info.parts.length ? (
                        <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-zinc-500" title={info.tooltip}>
                          {info.parts.map((p) => (
                            <span key={p.key}>
                              {p.label} <span className="font-semibold text-zinc-300">{p.value}</span>
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <ul className="space-y-2">
            {clips.map((c) => {
              const active = selected?.id === c.id;
              const info = clipScoreInfo(c);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => select(c)}
                    aria-pressed={active}
                    className={`panel flex w-full items-center gap-3 p-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 ${
                      active ? "ring-2 ring-emerald-400/60" : "hover:border-white/20"
                    } ${c.liked === false ? "opacity-60" : ""}`}
                  >
                    <div className="relative aspect-[9/16] w-12 shrink-0 overflow-hidden rounded-lg bg-black sm:w-14">
                      {c.coverPath ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.coverPath} alt="" loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <ClipPlaceholder status={c.status} compact />
                      )}
                    </div>
                    <div
                      title={info.tooltip}
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums ${
                        info.source === "ai"
                          ? "bg-emerald-400/15 text-emerald-300"
                          : "border border-dashed border-white/20 text-zinc-300"
                      }`}
                    >
                      {info.value}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-zinc-100">{c.title}</p>
                      <p className="text-[11px] tabular-nums text-zinc-500">
                        {formatClock(c.start)} → {formatClock(c.end)} · {formatDuration(c.end - c.start)}
                      </p>
                      {info.parts.length ? (
                        <div className="mt-0.5 hidden flex-wrap gap-x-2 text-[10px] text-zinc-500 sm:flex">
                          {info.parts.map((p) => (
                            <span key={p.key}>
                              {p.label} <span className="font-semibold text-zinc-300">{p.value}</span>
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    {c.liked === true ? <span className="pr-2 text-emerald-400" title="Disukai">♥</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <aside className="panel flex flex-col overflow-hidden lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start">
        {!selected ? (
          <p className="p-6 text-sm text-zinc-500">Pilih clip untuk detail.</p>
        ) : (
          <>
            <div className="border-b border-white/5 bg-black/40">
              {linuxDesktop && (selected.coverPath || selected.previewPath) ? (
                <div className="relative bg-black">
                  {selected.coverPath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={selected.coverPath}
                      alt=""
                      className="aspect-[9/16] max-h-[340px] w-full object-cover"
                    />
                  ) : (
                    <div className="aspect-[9/16] max-h-[340px] w-full" />
                  )}
                  {selected.previewPath ? (
                    <button
                      type="button"
                      onClick={() => void exportClip(true)}
                      disabled={saving}
                      className="absolute inset-0 flex items-center justify-center bg-black/35 text-sm font-semibold text-white"
                    >
                      {saving ? "Membuka…" : "Putar"}
                    </button>
                  ) : null}
                </div>
              ) : selected.previewPath ? (
                <video
                  key={selected.id}
                  src={selected.previewPath}
                  poster={selected.coverPath}
                  controls
                  playsInline
                  preload="metadata"
                  className="aspect-[9/16] max-h-[340px] w-full bg-black object-contain"
                />
              ) : selected.coverPath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={selected.coverPath} alt="" className="aspect-[9/16] max-h-[340px] w-full object-cover" />
              ) : (
                <div className="flex aspect-video items-center justify-center text-xs text-zinc-600">
                  Preview belum siap
                </div>
              )}
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              <div className="flex items-start justify-between gap-2">
                {(() => {
                  const info = clipScoreInfo(selected);
                  return (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-zinc-500">Skor viral</p>
                      <div className="flex items-baseline gap-2">
                        <p
                          className={`text-3xl font-semibold tabular-nums ${
                            info.source === "ai" ? "text-emerald-300" : "text-zinc-200"
                          }`}
                        >
                          {info.value}
                          <span className="text-sm font-normal text-zinc-600">/100</span>
                        </p>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            info.source === "ai"
                              ? "bg-emerald-400/10 text-emerald-300"
                              : info.source === "local"
                                ? "bg-amber-300/10 text-amber-200"
                                : "bg-white/5 text-zinc-400"
                          }`}
                          title={info.tooltip}
                        >
                          {info.label}
                        </span>
                      </div>
                    </div>
                  );
                })()}
                <div className="flex gap-1">
                  <button
                    type="button"
                    className={`btn btn-secondary !px-2.5 !py-1.5 ${selected.liked === true ? "!bg-emerald-400/20 !text-emerald-200" : ""}`}
                    onClick={() => void onPatchClip(selected.id, { liked: selected.liked === true ? null : true })}
                    title="Suka"
                    aria-label="Suka"
                    aria-pressed={selected.liked === true}
                  >
                    ♥
                  </button>
                  <button
                    type="button"
                    className={`btn btn-secondary !px-2.5 !py-1.5 ${selected.liked === false ? "!bg-red-400/20 !text-red-200" : ""}`}
                    onClick={() => void onPatchClip(selected.id, { liked: selected.liked === false ? null : false })}
                    title="Tidak suka (disembunyikan)"
                    aria-label="Tidak suka"
                    aria-pressed={selected.liked === false}
                  >
                    ✕
                  </button>
                </div>
              </div>

              {(() => {
                const info = clipScoreInfo(selected);
                return (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                      {info.parts.map((g) => (
                        <div key={g.key}>
                          <div className="mb-0.5 flex justify-between text-[11px] text-zinc-400">
                            <span>{g.label}</span>
                            <span className="font-semibold tabular-nums text-zinc-200">{g.value}</span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                            <div
                              className={`h-full rounded-full ${
                                info.source === "ai" ? "bg-gradient-to-r from-emerald-500 to-emerald-300" : "bg-zinc-400/70"
                              }`}
                              style={{ width: `${Math.round(g.value * 10)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    {info.reasons.length > 0 && (
                      <ul className="space-y-1 text-xs text-zinc-400">
                        {info.reasons.map((r, i) => (
                          <li key={i} className="flex gap-1.5">
                            <span className="text-emerald-400/70">•</span>
                            {r}
                          </li>
                        ))}
                      </ul>
                    )}
                    {info.source !== "ai" && (
                      <p className="text-[11px] leading-snug text-zinc-600">
                        {info.source === "local"
                          ? "Estimasi lokal dari transkrip (pertanyaan pembuka, emosi, kalimat utuh, kejelasan). Aktifkan AI di Settings untuk skor AI."
                          : info.tooltip}
                      </p>
                    )}
                    {selected.hook && (
                      <div className="rounded-xl border border-white/[0.07] bg-black/30 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wider text-zinc-500">Hook di video</p>
                        <p className="mt-0.5 text-sm font-semibold text-zinc-100">{selected.hook}</p>
                      </div>
                    )}
                  </div>
                );
              })()}

              <div>
                <label className="text-[11px] uppercase tracking-wide text-zinc-500">Judul clip</label>
                <input
                  value={titleDraft}
                  onChange={(e) => editDraft({ title: e.target.value })}
                  onBlur={() => void saveMeta()}
                  className="input mt-1"
                />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wide text-zinc-500">Deskripsi</label>
                <textarea
                  value={descDraft}
                  onChange={(e) => editDraft({ desc: e.target.value })}
                  onBlur={() => void saveMeta()}
                  rows={3}
                  className="input mt-1 resize-none"
                />
              </div>

              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">Transkrip</p>
                <div className="max-h-36 overflow-y-auto rounded-xl border border-white/10 bg-black/30 p-3 text-xs leading-relaxed text-zinc-300">
                  {(studio.transcript || [])
                    .filter((s) => s.end > selected.start && s.start < selected.end)
                    .map((s) => s.text)
                    .join(" ") || selected.reason || "—"}
                </div>
                <p className="mt-1 text-[11px] text-zinc-500">
                  {formatClock(selected.start)} → {formatClock(selected.end)} ·{" "}
                  {formatDuration(selected.end - selected.start)}
                </p>
              </div>

              {selected.error && <p className="text-xs text-red-400">{selected.error}</p>}
            </div>

            <div className="flex flex-wrap gap-2 border-t border-white/5 p-3">
              <button
                type="button"
                className="btn btn-primary flex-1"
                onClick={() => void exportClip(false)}
                disabled={saving || (!selected.previewPath && !selected.exportPaths)}
              >
                {saving ? "Menyimpan…" : "Download"}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={exportSrt}
                disabled={!studio.transcript?.length}
              >
                SRT
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function ScoreBadge({ info }: { info: ReturnType<typeof clipScoreInfo> }) {
  const ai = info.source === "ai";
  return (
    <div className="absolute left-2 top-2 flex items-center gap-1" title={info.tooltip}>
      <div
        className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white ${ai ? "score-ring" : ""}`}
        style={ai ? { ["--p" as string]: info.value } : undefined}
      >
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-full bg-black/80 ${
            ai ? "" : "border border-dashed border-white/30 text-zinc-200"
          }`}
        >
          {info.value}
        </span>
      </div>
      {!ai && (
        <span className="rounded-full bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-200">
          {info.source === "local" ? "est." : "lama"}
        </span>
      )}
    </div>
  );
}

function ClipPlaceholder({ status, compact }: { status?: string; compact?: boolean }) {
  const label = status === "error" ? "Gagal render" : status === "ready" ? "Tanpa cover" : "Rendering…";
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-b from-white/[0.04] to-transparent text-[10px] text-zinc-500">
      {status !== "error" && status !== "ready" ? (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/10 border-t-emerald-400" aria-hidden />
      ) : null}
      {compact ? null : <span>{label}</span>}
    </div>
  );
}
