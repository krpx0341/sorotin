"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { HookStyle, SkillPacks, Studio } from "@/lib/types";

export default function StudioDetailPage() {
  const params = useParams<{ id: string }>();
  const [studio, setStudio] = useState<Studio | null>(null);
  const [error, setError] = useState("");

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
    const t = setInterval(tick, 2500);
    return () => {
      alive = false;
      clearTimeout(boot);
      clearInterval(t);
    };
  }, [refresh]);

  async function updateSkills(patch: Partial<SkillPacks>, reprocess = false) {
    if (!studio) return;
    const r = await fetch("/api/studios", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: studio.id, skills: patch, reprocess }),
    });
    const j = await r.json();
    if (r.ok) setStudio(j.data);
  }

  async function reprocess() {
    await fetch(`/api/studios/${params.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reprocess" }),
    });
    await refresh();
  }

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-red-400">{error}</p>
        <Link href="/" className="mt-4 inline-block text-sm text-zinc-400 hover:text-white">
          ← Dashboard
        </Link>
      </main>
    );
  }

  if (!studio) {
    return <main className="mx-auto max-w-3xl px-4 py-10 text-sm text-zinc-400">Loading…</main>;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-4 py-8">
      <Link href="/" className="text-sm text-zinc-400 hover:text-white">
        ← Dashboard
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{studio.title}</h1>
          <p className="mt-1 text-xs text-zinc-500">
            {studio.source} · {studio.status}
            {studio.durationSec ? ` · ${Math.round(studio.durationSec)}s` : ""}
            {studio.error ? ` · ${studio.error}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void reprocess()}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-900"
        >
          Reprocess
        </button>
      </header>

      {studio.progress && (
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-zinc-300">{studio.progress.message}</span>
            <span className="text-zinc-500">{studio.progress.pct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-emerald-400 transition-all"
              style={{ width: `${Math.max(2, studio.progress.pct)}%` }}
            />
          </div>
        </section>
      )}

      <section className="rounded-xl border border-zinc-800 p-4">
        <h2 className="mb-3 text-sm font-medium text-zinc-300">Skill Packs</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["smartCover", "Smart Cover"],
              ["smartHook", "Smart Hook"],
              ["autoReframe", "Auto Reframe"],
              ["captions", "Captions"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={studio.skills[key]}
                onChange={(e) => void updateSkills({ [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
          <label className="text-sm">
            Hook style
            <select
              value={studio.skills.hookStyle}
              onChange={(e) => void updateSkills({ hookStyle: e.target.value as HookStyle })}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5"
            >
              {(["classic", "dark", "bold", "sticker", "clapper"] as HookStyle[]).map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          type="button"
          onClick={() => void updateSkills({}, true)}
          className="mt-4 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-black"
        >
          Apply + re-render
        </button>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">Clips ({studio.clips.length})</h2>
        {studio.clips.length === 0 ? (
          <p className="text-sm text-zinc-500">Belum ada clip — tunggu proses selesai.</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {studio.clips.map((c) => (
              <li key={c.id} className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50">
                {c.coverPath && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.coverPath} alt="" className="aspect-video w-full object-cover" />
                )}
                <div className="space-y-2 p-3">
                  <p className="text-sm font-medium">{c.title}</p>
                  <p className="text-xs text-zinc-500">
                    {c.start.toFixed(1)}s → {c.end.toFixed(1)}s · score {c.score} · {c.status}
                  </p>
                  {c.previewPath && (
                    <video src={c.previewPath} controls className="w-full rounded-lg bg-black" />
                  )}
                  {c.error && <p className="text-xs text-red-400">{c.error}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
