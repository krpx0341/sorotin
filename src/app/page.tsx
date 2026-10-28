"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { AspectRatio, HookStyle, SkillPacks, SourceKind, Studio } from "@/lib/types";
import { DEFAULT_SKILLS } from "@/lib/types";

export default function HomePage() {
  const [studios, setStudios] = useState<Studio[]>([]);
  const [source, setSource] = useState<SourceKind>("youtube");
  const [link, setLink] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [exportAspect, setExportAspect] = useState<AspectRatio>("9:16");
  const [skills, setSkills] = useState<SkillPacks>(DEFAULT_SKILLS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
    const t = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearTimeout(boot);
      clearInterval(t);
    };
  }, [refresh]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      let r: Response;
      if (source === "upload") {
        if (!file) throw new Error("Pilih file video");
        const fd = new FormData();
        fd.append("file", file);
        fd.append("source", "upload");
        if (title) fd.append("title", title);
        fd.append("exportAspect", exportAspect);
        fd.append("skills", JSON.stringify(skills));
        r = await fetch("/api/studios", { method: "POST", body: fd });
      } else {
        r = await fetch("/api/studios", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source, link, title: title || undefined, exportAspect, skills }),
        });
      }
      const j = await r.json();
      if (!r.ok || !j.status) throw new Error(j.message || "Gagal buat studio");
      setLink("");
      setFile(null);
      setTitle("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-4 py-8">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Local only</p>
        <h1 className="text-3xl font-semibold tracking-tight">Personal Clipper</h1>
        <p className="mt-1 text-sm text-zinc-400">
          URL/upload → yt-dlp/ffmpeg → whisper → clips + Skill Packs. Data di folder lokal.
        </p>
      </header>

      <form
        onSubmit={onCreate}
        className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-xl shadow-black/30"
      >
        <div className="mb-4 flex flex-wrap gap-2">
          {(["youtube", "tiktok", "upload"] as SourceKind[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSource(s)}
              className={`rounded-full px-4 py-1.5 text-sm capitalize ${
                source === s ? "bg-white text-black" : "border border-zinc-700 text-zinc-300"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {source === "upload" ? (
          <input
            type="file"
            accept="video/*"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="mb-3 block w-full text-sm text-zinc-300"
          />
        ) : (
          <input
            type="url"
            required
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder={
              source === "tiktok" ? "https://www.tiktok.com/..." : "https://www.youtube.com/watch?v=..."
            }
            className="mb-3 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-zinc-400"
          />
        )}

        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Judul (opsional)"
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-zinc-400"
          />
          <select
            value={exportAspect}
            onChange={(e) => setExportAspect(e.target.value as AspectRatio)}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          >
            <option value="9:16">9:16</option>
            <option value="1:1">1:1</option>
            <option value="16:9">16:9</option>
          </select>
        </div>

        <fieldset className="mb-4 rounded-xl border border-zinc-800 p-4">
          <legend className="px-1 text-xs uppercase tracking-wide text-zinc-500">Skill Packs</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["smartCover", "Smart Cover"],
                ["smartHook", "Smart Hook"],
                ["autoReframe", "Auto Reframe"],
                ["captions", "Captions"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={skills[key]}
                  onChange={(e) => setSkills((s) => ({ ...s, [key]: e.target.checked }))}
                />
                {label}
              </label>
            ))}
            <label className="text-sm text-zinc-300">
              Hook style
              <select
                value={skills.hookStyle}
                onChange={(e) => setSkills((s) => ({ ...s, hookStyle: e.target.value as HookStyle }))}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5"
              >
                {(["classic", "dark", "bold", "sticker", "clapper"] as HookStyle[]).map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-zinc-300">
              Caption language
              <select
                value={skills.captionLanguage}
                onChange={(e) =>
                  setSkills((s) => ({
                    ...s,
                    captionLanguage: e.target.value as SkillPacks["captionLanguage"],
                  }))
                }
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5"
              >
                <option value="id">id</option>
                <option value="en">en</option>
                <option value="auto">auto</option>
              </select>
            </label>
          </div>
        </fieldset>

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
        >
          {busy ? "Memproses..." : "Buat Clip"}
        </button>
      </form>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium">History</h2>
          <button type="button" onClick={() => void refresh()} className="text-xs text-zinc-400 hover:text-white">
            Refresh
          </button>
        </div>
        {studios.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
            Belum ada studio.
          </p>
        ) : (
          <ul className="space-y-3">
            {studios.map((s) => (
              <li key={s.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link href={`/studios/${s.id}`} className="text-base font-medium hover:underline">
                      {s.title}
                    </Link>
                    <p className="mt-1 text-xs text-zinc-500">
                      {s.source} · {s.status}
                      {s.clips?.length ? ` · ${s.clips.length} clips` : ""}
                      {s.error ? ` · ${s.error}` : ""}
                    </p>
                    {s.progress && s.status !== "ready" && (
                      <div className="mt-2 max-w-md">
                        <div className="mb-1 flex justify-between text-[11px] text-zinc-500">
                          <span className="truncate pr-2">{s.progress.message}</span>
                          <span>{s.progress.pct}%</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                          <div
                            className="h-full rounded-full bg-emerald-400 transition-all"
                            style={{ width: `${Math.max(2, s.progress.pct)}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      s.status === "ready"
                        ? "bg-emerald-500/20 text-emerald-300"
                        : s.status === "error"
                          ? "bg-red-500/20 text-red-300"
                          : "bg-amber-500/20 text-amber-200"
                    }`}
                  >
                    {s.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
