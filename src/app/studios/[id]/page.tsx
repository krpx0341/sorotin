"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ClipWorkspace } from "@/components/ClipWorkspace";
import { Select } from "@/components/Select";
import { Switch } from "@/components/Switch";
import { studioDisplayTitle } from "@/lib/title";
import type { HookStyle, SkillPacks, Studio } from "@/lib/types";
import { formatDuration, isBusyStatus, stageLabel, statusTone } from "@/lib/ui";

export default function StudioDetailPage() {
  const params = useParams<{ id: string }>();
  const [studio, setStudio] = useState<Studio | null>(null);
  const [error, setError] = useState("");
  const [actionBusy, setActionBusy] = useState<"stop" | "reprocess" | "apply" | "">("");
  const [skillsDirty, setSkillsDirty] = useState(false);
  const [showSkills, setShowSkills] = useState(false);

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/studios/${params.id}`);
    const j = await r.json();
    if (!r.ok) {
      setError(j.message || "not found");
      return;
    }
    setStudio(j.data);
  }, [params.id]);

  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (alive) void refresh();
    };
    const boot = setTimeout(tick, 0);
    const t = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearTimeout(boot);
      clearInterval(t);
    };
  }, [refresh]);

  const busy = useMemo(() => (studio ? isBusyStatus(studio.status) : false), [studio]);

  async function updateSkills(patch: Partial<SkillPacks>) {
    if (!studio) return;
    // Optimistic local toggle so UI feels instant; persist without re-render.
    setStudio((s) => (s ? { ...s, skills: { ...s.skills, ...patch } } : s));
    setSkillsDirty(true);
    const r = await fetch("/api/studios", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: studio.id, skills: patch }),
    });
    const j = await r.json();
    if (r.ok) setStudio(j.data);
  }

  /** Apply skill packs by re-rendering clips (keeps transcript) — not full Whisper. */
  async function applySkills() {
    if (!studio) return;
    setActionBusy("apply");
    try {
      setStudio((s) =>
        s
          ? {
              ...s,
              status: "queued",
              error: undefined,
              progress: { pct: 0, message: "Re-render queued…" },
            }
          : s,
      );
      const r = await fetch("/api/studios", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: studio.id, skills: studio.skills, rerender: true }),
      });
      const j = await r.json();
      if (r.ok) {
        setStudio(j.data);
        setSkillsDirty(false);
      }
      await refresh();
    } finally {
      setActionBusy("");
    }
  }

  async function patchClip(
    clipId: string,
    clipPatch: { liked?: boolean | null; hidden?: boolean; title?: string; description?: string },
  ) {
    if (!studio) return;
    const r = await fetch("/api/studios", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: studio.id, clipId, clipPatch }),
    });
    const j = await r.json();
    if (r.ok) setStudio(j.data);
  }

  async function renameStudio(displayTitle: string) {
    if (!studio) return;
    // Optimistic so the header doesn't flash back to the old title.
    setStudio((s) => (s ? { ...s, displayTitle: displayTitle || undefined } : s));
    const r = await fetch("/api/studios", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: studio.id, displayTitle }),
    });
    const j = await r.json();
    if (r.ok) setStudio(j.data);
  }

  async function reprocess() {
    setActionBusy("reprocess");
    try {
      // Optimistic: show Stop immediately
      setStudio((s) =>
        s
          ? {
              ...s,
              status: "queued",
              error: undefined,
              progress: { pct: 0, message: "Queued…" },
            }
          : s,
      );
      await fetch(`/api/studios/${params.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reprocess" }),
      });
      await refresh();
    } finally {
      setActionBusy("");
    }
  }

  async function stop() {
    setActionBusy("stop");
    try {
      const r = await fetch(`/api/studios/${params.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      const j = await r.json();
      if (r.ok) setStudio(j.data);
      else await refresh();
    } finally {
      setActionBusy("");
    }
  }

  if (error) {
    return (
      <AppShell>
        <p className="text-red-400">{error}</p>
        <Link href="/" className="mt-4 inline-block text-sm text-zinc-400 hover:text-white">
          ← Semua project
        </Link>
      </AppShell>
    );
  }

  if (!studio) {
    return (
      <AppShell>
        <p className="text-sm text-zinc-400">Memuat project…</p>
      </AppShell>
    );
  }

  const stopBtn = (
    <button
      type="button"
      onClick={() => void stop()}
      disabled={actionBusy === "stop"}
      className="btn btn-danger"
    >
      {actionBusy === "stop" ? "Stopping…" : "Stop"}
    </button>
  );

  const reprocessBtn = (
    <button
      type="button"
      onClick={() => void reprocess()}
      disabled={actionBusy === "reprocess" || busy}
      className="btn btn-secondary"
    >
      {actionBusy === "reprocess" ? "Starting…" : "Reprocess"}
    </button>
  );

  const stopped = studio.error === "Stopped" || studio.error === "Dibatalkan";
  const displayTitle = studioDisplayTitle(studio);
  const visibleClips = studio.clips?.filter((c) => !c.hidden).length ?? 0;
  const meta = [
    studio.durationSec ? formatDuration(studio.durationSec) : "",
    studio.exportAspect,
    studio.targetSec ? `~${studio.targetSec}s/clip` : "",
    studio.genre || "",
    visibleClips ? `${visibleClips} clip` : "",
  ].filter(Boolean);

  return (
    <AppShell>
      <Link href="/" className="mb-3 inline-flex items-center gap-1 text-xs text-zinc-500 transition hover:text-zinc-200">
        <span aria-hidden>←</span> Semua project
      </Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <EditableTitle key={displayTitle} value={displayTitle} onSave={(t) => void renameStudio(t)} />
            <span className={`badge ${statusTone(studio.status)}`}>{stageLabel(studio.status)}</span>
          </div>
          {studio.title && studio.title.trim() !== displayTitle ? (
            <p className="mt-1 max-w-3xl truncate text-xs text-zinc-600" title={studio.title}>
              Judul asli: {studio.title}
            </p>
          ) : null}
          <p className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm text-zinc-400">
            <SourceChip source={studio.source} url={studio.sourceUrl} />
            <span className="tabular-nums">{meta.join("  ·  ")}</span>
            {studio.ranking ? (
              <span className="flex items-center gap-2">
                <span
                  title={studio.ranking.error || studio.ranking.model || ""}
                  className={`badge ${
                    studio.ranking.source === "ai" ? "bg-emerald-400/10 text-emerald-300" : "bg-white/5 text-zinc-400"
                  }`}
                >
                  {studio.ranking.source === "ai" ? "AI ranking" : "Ranking lokal"}
                  {studio.ranking.model ? <span className="font-normal opacity-70">{studio.ranking.model}</span> : null}
                </span>
              </span>
            ) : null}
          </p>
          {studio.ranking?.error ? <p className="mt-1 text-xs text-amber-300/80">{studio.ranking.error}</p> : null}
          {studio.error && !stopped && <p className="mt-2 text-sm text-red-300">{studio.error}</p>}
          {stopped && <p className="mt-2 text-sm text-amber-200">Proses dihentikan. Bisa Reprocess kapan saja.</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowSkills((v) => !v)}
            aria-expanded={showSkills}
            className={`btn btn-secondary ${showSkills ? "!border-emerald-400/30 !text-emerald-200" : ""}`}
          >
            Skill packs
            {skillsDirty ? <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-amber-300" aria-label="belum di-apply" /> : null}
          </button>
          {busy ? stopBtn : reprocessBtn}
        </div>
      </div>

      {(busy || stopped) && (
        <section className="panel mb-6 p-4">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate text-zinc-200">
              {studio.progress?.message || (busy ? "Memproses…" : "Dihentikan")}
            </span>
            <span className="shrink-0 tabular-nums text-zinc-500">{studio.progress?.pct ?? 0}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full transition-all duration-500 ${stopped ? "bg-amber-400" : "bg-emerald-400"}`}
              style={{ width: `${Math.max(2, studio.progress?.pct ?? 0)}%` }}
            />
          </div>
          {busy && (
            <p className="mt-2 text-xs text-zinc-500">Stop membatalkan Whisper/ffmpeg yang sedang jalan untuk project ini.</p>
          )}
        </section>
      )}

      {showSkills && (
        <section className="panel mb-6 p-5">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-zinc-200">Skill packs</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Efek yang dibakar ke video (cover, hook di detik awal, crop wajah, caption karaoke). Ubah, lalu
              Apply — clip di-render ulang tanpa transkripsi ulang.
            </p>
            {skillsDirty ? (
              <p className="mt-2 text-xs font-medium text-amber-300">
                Ada perubahan belum di-apply ke clip.
              </p>
            ) : (
              <p className="mt-2 text-xs text-emerald-400/80">Clip mengikuti skill yang aktif sekarang.</p>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["smartCover", "Smart Cover", "Cover dari frame yang dipilih"],
                ["smartHook", "Smart Hook", "Kartu judul di detik awal"],
                ["autoReframe", "Auto Reframe", "Crop mengikuti wajah"],
                ["captions", "Captions", "Subtitle karaoke per kata"],
              ] as const
            ).map(([key, label, hint]) => (
              <div
                key={key}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 p-3"
              >
                <span>
                  <span className="block text-sm text-zinc-200">{label}</span>
                  <span className="block text-xs text-zinc-500">{hint}</span>
                </span>
                <Switch
                  size="sm"
                  label={label}
                  checked={studio.skills[key]}
                  disabled={busy}
                  onChange={(v) => void updateSkills({ [key]: v })}
                />
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 p-3">
              <span>
                <span className="block text-sm text-zinc-200">Gaya hook</span>
                <span className="block text-xs text-zinc-500">Tampilan kartu judul di awal video</span>
              </span>
              <Select<HookStyle>
                label="Gaya hook"
                value={studio.skills.hookStyle}
                disabled={busy}
                onChange={(v) => void updateSkills({ hookStyle: v })}
                align="right"
                className="w-32"
                options={[
                  { value: "classic", label: "Classic" },
                  { value: "dark", label: "Dark" },
                  { value: "bold", label: "Bold" },
                  { value: "sticker", label: "Sticker" },
                  { value: "clapper", label: "Clapper" },
                ]}
              />
            </div>
          </div>
          <button
            type="button"
            disabled={busy || actionBusy === "apply" || !skillsDirty}
            onClick={() => void applySkills()}
            className={`btn mt-4 ${skillsDirty ? "btn-primary" : "btn-secondary"}`}
          >
            {actionBusy === "apply"
              ? "Re-rendering…"
              : skillsDirty
                ? "Apply skill → re-render clips"
                : "Tidak ada perubahan"}
          </button>
        </section>
      )}

      <ClipWorkspace studio={studio} onPatchClip={patchClip} />
    </AppShell>
  );
}

function EditableTitle({ value, onSave }: { value: string; onSave: (t: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (editing) {
    const commit = () => {
      setEditing(false);
      const t = draft.replace(/\s+/g, " ").trim();
      if (t !== value) onSave(t);
    };
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        placeholder="Kosongkan untuk judul otomatis"
        aria-label="Judul project"
        className="input min-w-0 max-w-2xl flex-1 !py-1.5 text-xl font-semibold"
      />
    );
  }
  return (
    <h1 className="group flex min-w-0 max-w-full items-start gap-2 text-xl font-bold leading-tight tracking-tight sm:text-2xl">
      <span className="line-clamp-2 break-words" title={value}>
        {value}
      </span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Ganti nama"
        aria-label="Ganti nama project"
        className="shrink-0 rounded-md p-1 text-zinc-600 opacity-60 transition hover:bg-white/5 hover:text-zinc-200 group-hover:opacity-100"
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
          <path d="M10.5 2.5l3 3L6 13H3v-3l7.5-7.5z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      </button>
    </h1>
  );
}

function SourceChip({ source, url }: { source: string; url?: string }) {
  const label = source === "youtube" ? "YouTube" : source === "tiktok" ? "TikTok" : source === "upload" ? "Upload" : source;
  const cls = "inline-flex items-center gap-1.5 rounded-md bg-white/5 px-2 py-0.5 text-xs text-zinc-300";
  const dot = <span className={`h-1.5 w-1.5 rounded-full ${source === "youtube" ? "bg-red-400" : "bg-emerald-400"}`} aria-hidden />;
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className={`${cls} transition hover:bg-white/10 hover:text-white`} title={url}>
      {dot}
      {label} ↗
    </a>
  ) : (
    <span className={cls}>
      {dot}
      {label}
    </span>
  );
}
