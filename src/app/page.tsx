"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { studioDisplayTitle } from "@/lib/title";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import {
  DEFAULT_SKILLS,
  type AspectRatio,
  type SkillPacks,
  type SourceKind,
  type Studio,
} from "@/lib/types";
import { formatDuration, formatRelativeTime, isBusyStatus } from "@/lib/ui";
import {
  AdvancedPanel,
  AdvancedToggle,
  AiModelChip,
  Icon,
  SourceTabs,
  optionsSummary,
} from "@/components/home/NewClipParts";

const STATUS_UI: Record<string, { label: string; cls: string; dot: string }> = {
  ready: { label: "Siap", cls: "border-emerald-400/30 bg-emerald-950/70 text-emerald-200", dot: "bg-emerald-400" },
  error: { label: "Berhenti", cls: "border-red-400/30 bg-red-950/70 text-red-200", dot: "bg-red-400" },
  queued: { label: "Antre", cls: "border-white/15 bg-black/60 text-zinc-300", dot: "bg-zinc-400" },
  downloading: { label: "Download", cls: "border-sky-400/30 bg-sky-950/70 text-sky-200", dot: "bg-sky-400 animate-pulse" },
  transcribing: { label: "Transkrip", cls: "border-sky-400/30 bg-sky-950/70 text-sky-200", dot: "bg-sky-400 animate-pulse" },
  clipping: { label: "Cari momen", cls: "border-sky-400/30 bg-sky-950/70 text-sky-200", dot: "bg-sky-400 animate-pulse" },
  rendering: { label: "Render", cls: "border-sky-400/30 bg-sky-950/70 text-sky-200", dot: "bg-sky-400 animate-pulse" },
};

const SOURCE_ICON: Record<string, keyof typeof Icon> = { youtube: "youtube", tiktok: "tiktok", upload: "upload" };

function studioCover(s: Studio): string | undefined {
  const visible = (s.clips ?? []).filter((c) => !c.hidden);
  const ready = visible.find((c) => c.status === "ready" && (c.coverPath || c.previewPath));
  const any = visible.find((c) => c.coverPath || c.previewPath);
  return (ready || any)?.coverPath || (ready || any)?.previewPath;
}

function visibleClipCount(s: Studio) {
  return (s.clips ?? []).filter((c) => !c.hidden).length;
}

export default function HomePage() {
  const router = useRouter();
  const [studios, setStudios] = useState<Studio[]>([]);
  const [source, setSource] = useState<SourceKind>("youtube");
  const [link, setLink] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [localPath, setLocalPath] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [exportAspect, setExportAspect] = useState<AspectRatio>("9:16");
  const [targetSec, setTargetSec] = useState(40);
  const [genre, setGenre] = useState("podcast");
  const [skills, setSkills] = useState<SkillPacks>(DEFAULT_SKILLS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showOptions, setShowOptions] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/studios");
    const j = await r.json();
    setStudios(j.data?.items ?? []);
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (alive) void refresh();
    };
    const boot = setTimeout(tick, 0);
    const t = setInterval(tick, 2500);
    return () => {
      alive = false;
      clearTimeout(boot);
      clearInterval(t);
    };
  }, [refresh]);

  function focusHero() {
    const el = document.getElementById("new-clip");
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => {
      if (source === "upload") fileRef.current?.click();
      else linkRef.current?.focus();
    }, 280);
  }

  async function stopStudio(id: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    await fetch(`/api/studios/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop" }),
    });
    await refresh();
  }

  function pickDroppedFile(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = Array.from(e.dataTransfer.files || []).find(
      (x) => x.type.startsWith("video/") || /\.(mp4|mov|mkv|webm|m4v|avi)$/i.test(x.name),
    );
    if (f) {
      setSource("upload");
      setFile(f);
      setLocalPath("");
      setError("");
    } else if (e.dataTransfer.files?.length) {
      setError("File yang di-drop bukan video");
    }
  }

  /** XHR (not fetch) so big uploads show progress. */
  function uploadWithProgress(fd: FormData): Promise<{ ok: boolean; json: { status?: boolean; message?: string; data?: { id: string } } }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/studios");
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) setUploadPct(Math.round((ev.loaded / ev.total) * 100));
      };
      xhr.onload = () => {
        try {
          resolve({ ok: xhr.status < 400, json: JSON.parse(xhr.responseText || "{}") });
        } catch {
          reject(new Error(`Upload gagal (${xhr.status})`));
        }
      };
      xhr.onerror = () => reject(new Error("Upload gagal (koneksi)"));
      xhr.send(fd);
    });
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      let r: Response;
      if (source === "upload") {
        if (!file && !localPath.trim()) throw new Error("Pilih/drop file video, atau isi path file lokal");
        const fd = new FormData();
        if (file) fd.append("file", file);
        else fd.append("localPath", localPath.trim());
        fd.append("source", "upload");
        if (title) fd.append("title", title);
        fd.append("exportAspect", exportAspect);
        fd.append("targetSec", String(targetSec));
        fd.append("genre", genre);
        fd.append("skills", JSON.stringify(skills));
        setUploadPct(file ? 0 : null);
        const up = await uploadWithProgress(fd);
        setUploadPct(null);
        if (!up.ok || !up.json.status || !up.json.data) throw new Error(up.json.message || "Gagal buat studio");
        router.push(`/studios/${up.json.data.id}`);
        return;
      } else {
        r = await fetch("/api/studios", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source,
            link,
            title: title || undefined,
            exportAspect,
            targetSec,
            genre,
            skills,
          }),
        });
      }
      const j = await r.json();
      if (!r.ok || !j.status) throw new Error(j.message || "Gagal buat studio");
      router.push(`/studios/${j.data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setUploadPct(null);
      setBusy(false);
    }
  }

  const summary = optionsSummary({ exportAspect, targetSec, genre, skills });

  return (
    <AppShell
      actions={
        <button type="button" onClick={focusHero} className="btn btn-primary">
          + Clip baru
        </button>
      }
    >
      {/* Hero */}
      <section id="new-clip" className="mx-auto max-w-3xl pb-4 pt-6 text-center sm:pt-10 lg:pt-14">
        <p className="inline-flex items-center gap-2 rounded-full border border-emerald-400/15 bg-emerald-400/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/90">
          <span className="h-1.5 w-1.5 rounded-full bg-spot shadow-[0_0_8px_rgba(250,204,21,0.7)]" aria-hidden />
          AI clipper untuk video panjang
        </p>
        <h1 className="font-display mt-4 text-balance text-3xl font-extrabold tracking-[-0.02em] text-zinc-50 sm:text-[2.8rem] sm:leading-[1.08]">
          Sorot <span className="text-emerald-400">momen terbaikmu</span>.
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-zinc-500">
          Tempel link atau upload video. AI pilih clip, reframe ke wajah, tulis caption, dan beri skor.
        </p>

        <form
          onSubmit={onCreate}
          className="mt-8"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
              setDragOver(true);
            }
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setDragOver(false);
          }}
          onDrop={pickDroppedFile}
        >
          <SourceTabs value={source} onChange={setSource} />

          <div className="mx-auto mt-4 max-w-2xl text-left">
            <div
              className={`hero-input group ${source === "upload" ? "border-dashed" : ""} ${
                dragOver ? "!border-emerald-400/70 bg-emerald-400/[0.06] ring-4 ring-emerald-400/15" : ""
              }`}
            >
              {source === "upload" ? (
                <label className="flex min-h-[4rem] min-w-0 flex-1 cursor-pointer items-center gap-3 px-4 py-3">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="video/*"
                    className="sr-only"
                    onChange={(e) => {
                      setFile(e.target.files?.[0] || null);
                      if (e.target.files?.[0]) setLocalPath("");
                    }}
                  />
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition ${
                      file || dragOver ? "bg-emerald-400/15 text-emerald-300" : "bg-white/5 text-zinc-400 group-hover:text-zinc-200"
                    }`}
                  >
                    <Icon.upload className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-zinc-100">
                      {dragOver
                        ? "Lepas untuk upload"
                        : file
                          ? file.name
                          : "Klik pilih video, atau drag & drop ke sini"}
                    </span>
                    <span className="block text-xs text-zinc-500">
                      {uploadPct != null
                        ? `Upload ${uploadPct}%…`
                        : file
                          ? `${(file.size / 1e6).toFixed(0)} MB · siap diproses`
                          : "MP4, MOV, MKV, WEBM — diproses lokal di mesinmu"}
                    </span>
                    {uploadPct != null && (
                      <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-white/10">
                        <span
                          className="block h-full rounded-full bg-emerald-400 transition-[width]"
                          style={{ width: `${uploadPct}%` }}
                        />
                      </span>
                    )}
                  </span>
                </label>
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-3 pl-4">
                  <span className="hidden shrink-0 text-zinc-600 sm:block">
                    {source === "tiktok" ? <Icon.tiktok className="h-5 w-5" /> : <Icon.youtube className="h-5 w-5" />}
                  </span>
                  <input
                    ref={linkRef}
                    type="url"
                    required
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                    aria-label={source === "tiktok" ? "Link TikTok" : "Link YouTube"}
                    placeholder={
                      source === "tiktok"
                        ? "Tempel link TikTok — https://www.tiktok.com/…"
                        : "Tempel link YouTube — https://www.youtube.com/watch?v=…"
                    }
                    className="min-h-[4rem] min-w-0 flex-1 bg-transparent py-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
                  />
                </div>
              )}
              <button
                type="submit"
                disabled={busy}
                className="m-2 inline-flex shrink-0 items-center gap-2 self-center rounded-xl bg-emerald-400 px-4 py-3 text-sm font-semibold text-[#052e1c] shadow-[0_8px_30px_-8px_rgba(52,211,153,0.6)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-400/30 disabled:opacity-45 sm:px-5"
              >
                {busy ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#052e1c]/30 border-t-[#052e1c]" />
                ) : (
                  <Icon.sparkle className="h-4 w-4" />
                )}
                <span className={busy ? "" : "hidden min-[400px]:inline"}>
                  {busy ? (uploadPct != null ? `${uploadPct}%` : "Memproses") : "Buat clip"}
                </span>
                {!busy && <span className="sr-only min-[400px]:hidden">Buat clip</span>}
              </button>
            </div>

            {source === "upload" && (
              <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-white/[0.06] bg-black/25 px-3 py-1.5">
                <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-600">
                  atau path
                </span>
                <input
                  type="text"
                  value={localPath}
                  onChange={(e) => {
                    setLocalPath(e.target.value);
                    if (e.target.value) setFile(null);
                  }}
                  aria-label="Path file video lokal"
                  placeholder="/home/han/Videos/video.mp4 — dipakai langsung, tanpa copy"
                  spellCheck={false}
                  className="min-w-0 flex-1 bg-transparent py-1 font-mono text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
                />
              </div>
            )}

            {error && (
              <p className="mt-3 rounded-xl border border-red-400/20 bg-red-400/[0.06] px-3.5 py-2.5 text-sm text-red-200">
                {error}
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <AiModelChip />
            </div>

            <div className="mt-4">
              <AdvancedToggle open={showOptions} onToggle={() => setShowOptions((v) => !v)} summary={summary} />
              {showOptions && (
                <AdvancedPanel
                  title={title}
                  setTitle={setTitle}
                  exportAspect={exportAspect}
                  setExportAspect={setExportAspect}
                  targetSec={targetSec}
                  setTargetSec={setTargetSec}
                  genre={genre}
                  setGenre={setGenre}
                  skills={skills}
                  setSkills={setSkills}
                />
              )}
            </div>
          </div>
        </form>
      </section>

      {/* Studio terbaru */}
      <section className="mx-auto mt-8 max-w-5xl sm:mt-12 lg:mt-16">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Project</p>
            <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold tracking-tight text-zinc-100">
              Studio terbaru
              {studios.length > 0 && (
                <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-xs font-medium text-zinc-400">
                  {studios.length}
                </span>
              )}
            </h2>
          </div>
          <button type="button" onClick={() => void refresh()} className="btn btn-ghost !px-3 !py-1.5 !text-xs">
            ↻ Refresh
          </button>
        </div>

        {studios.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/12 bg-black/20 px-6 py-16 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-400/10 text-emerald-300/80">
              <Icon.upload className="h-6 w-6" />
            </div>
            <p className="text-base font-medium text-zinc-200">Belum ada studio</p>
            <p className="mt-1 max-w-xs text-sm text-zinc-500">Buat clip baru untuk memulai.</p>
            <button type="button" onClick={focusHero} className="btn btn-primary mt-6">
              + Clip baru
            </button>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {studios.map((s) => {
              const cover = studioCover(s);
              const clips = visibleClipCount(s);
              const st = STATUS_UI[s.status] || STATUS_UI.queued;
              const SrcIcon = Icon[SOURCE_ICON[s.source] || "upload"];
              const busyNow = isBusyStatus(s.status);
              const errMsg = s.status === "error" && s.error && !/^(Stopped|Dibatalkan)/.test(s.error) ? s.error : "";
              return (
                <li key={s.id}>
                  <div className="panel group h-full overflow-hidden transition duration-200 hover:-translate-y-0.5 hover:border-emerald-400/30 hover:shadow-[0_20px_40px_-20px_rgba(52,211,153,0.25)]">
                    <Link
                      href={`/studios/${s.id}`}
                      className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400/40"
                    >
                      <div className="relative aspect-video overflow-hidden bg-black/40">
                        {cover ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={cover}
                            alt=""
                            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_50%_40%,rgba(52,211,153,0.08),transparent_60%)]">
                            <SrcIcon className="h-8 w-8 text-zinc-700" />
                          </div>
                        )}
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent" />
                        <span
                          className={`absolute left-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium backdrop-blur-md ${st.cls}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                          {st.label}
                        </span>
                        {s.durationSec ? (
                          <span className="absolute bottom-2.5 right-2.5 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[10.5px] text-zinc-200 backdrop-blur">
                            {formatDuration(s.durationSec)}
                          </span>
                        ) : null}
                        {clips > 0 && (
                          <span className="absolute bottom-2.5 left-2.5 rounded-md bg-emerald-400/90 px-1.5 py-0.5 text-[10.5px] font-semibold text-[#052e1c]">
                            {clips} clip
                          </span>
                        )}
                      </div>
                      <div className="p-3.5">
                        <p className="line-clamp-2 text-sm font-medium leading-snug text-zinc-100" title={s.title}>
                          {studioDisplayTitle(s)}
                        </p>
                        <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px] text-zinc-500">
                          <SrcIcon className="h-3.5 w-3.5 text-zinc-600" />
                          <span className="font-mono text-zinc-400">{s.exportAspect}</span>
                          {s.genre ? (
                            <>
                              <span className="text-zinc-700">·</span>
                              <span className="capitalize">{s.genre}</span>
                            </>
                          ) : null}
                          <span className="text-zinc-700">·</span>
                          <span>{formatRelativeTime(s.updatedAt)}</span>
                        </p>
                        {errMsg && <p className="mt-2 line-clamp-2 text-[11.5px] text-red-300/80">{errMsg}</p>}
                      </div>
                    </Link>
                    {busyNow && (
                      <div className="flex items-end gap-3 border-t border-white/5 px-3.5 pb-3.5 pt-3">
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex justify-between text-[11px] text-zinc-500">
                            <span className="truncate pr-2">{s.progress?.message || "Memproses…"}</span>
                            <span className="tabular-nums">{s.progress?.pct ?? 0}%</span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                            <div
                              className="h-full rounded-full bg-emerald-400 transition-[width]"
                              style={{ width: `${Math.max(3, s.progress?.pct ?? 0)}%` }}
                            />
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn btn-danger !px-3 !py-1.5 !text-xs"
                          onClick={(e) => void stopStudio(s.id, e)}
                        >
                          Stop
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </AppShell>
  );
}
