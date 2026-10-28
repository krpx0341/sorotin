"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type PublicSettings = {
  baseUrl: string;
  model: string;
  enabled: boolean;
  hasApiKey: boolean;
};

type AiModel = { id: string; owned_by?: string };

export default function SettingsPage() {
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:20128/v1");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [models, setModels] = useState<AiModel[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const r = await fetch("/api/settings");
    const j = await r.json();
    const d = j.data as PublicSettings;
    setBaseUrl(d.baseUrl);
    setModel(d.model);
    setEnabled(d.enabled);
    setHasApiKey(d.hasApiKey);
  }, []);

  useEffect(() => {
    let alive = true;
    const boot = setTimeout(() => {
      if (alive) void load();
    }, 0);
    return () => {
      alive = false;
      clearTimeout(boot);
    };
  }, [load]);

  async function save(partial?: Partial<{ baseUrl: string; apiKey: string; model: string; enabled: boolean }>) {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const body = {
        baseUrl,
        model,
        enabled,
        ...(apiKey ? { apiKey } : {}),
        ...partial,
      };
      const r = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || !j.status) throw new Error(j.message || "Gagal simpan");
      const d = j.data as PublicSettings;
      setBaseUrl(d.baseUrl);
      setModel(d.model);
      setEnabled(d.enabled);
      setHasApiKey(d.hasApiKey);
      setApiKey("");
      setMsg("Tersimpan");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function fetchModels() {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      // Save current URL/key first so GET/POST use them.
      await save({ baseUrl, ...(apiKey ? { apiKey } : {}), enabled, model });
      const r = await fetch("/api/ai/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl, ...(apiKey ? { apiKey } : {}) }),
      });
      const j = await r.json();
      if (!r.ok || !j.status) throw new Error(j.message || "Gagal fetch models");
      const list = (j.data?.models || []) as AiModel[];
      setModels(list);
      setMsg(`${list.length} model`);
      if (!model && list[0]) setModel(list[0].id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8">
      <Link href="/" className="text-sm text-zinc-400 hover:text-white">
        ← Dashboard
      </Link>
      <header>
        <h1 className="text-2xl font-semibold">AI Settings</h1>
        <p className="mt-1 text-sm text-zinc-400">
          OpenAI-compatible endpoint (9router / Vikey / dll). Isi base URL + API key, fetch models, pilih model
          untuk ranking clip otomatis.
        </p>
      </header>

      <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
        <label className="block text-sm">
          Base URL
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://127.0.0.1:20128/v1"
            className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-sm">
          API key {hasApiKey ? <span className="text-zinc-500">(tersimpan — kosongkan = keep)</span> : null}
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={hasApiKey ? "•••••••• (opsional ganti)" : "sk-... / token 9router"}
            className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void fetchModels()}
            className="rounded-xl border border-zinc-600 px-3 py-2 text-sm hover:bg-zinc-800 disabled:opacity-50"
          >
            Fetch models
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="rounded-xl bg-emerald-400 px-3 py-2 text-sm font-medium text-black disabled:opacity-50"
          >
            Save
          </button>
        </div>

        <label className="block text-sm">
          Model
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          >
            <option value="">— pilih —</option>
            {model && !models.some((m) => m.id === model) && <option value={model}>{model}</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
                {m.owned_by ? ` (${m.owned_by})` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Pakai AI untuk ranking clip (fallback lokal kalau gagal)
        </label>

        {msg && <p className="text-sm text-emerald-300">{msg}</p>}
        {err && <p className="text-sm text-red-400">{err}</p>}
      </section>

      <p className="text-xs text-zinc-500">
        Contoh 9router lokal: <code className="text-zinc-300">http://127.0.0.1:20128/v1</code>. Remote butuh API
        key. Settings disimpan di <code className="text-zinc-300">data/settings.json</code> (tidak di-commit).
      </p>
    </main>
  );
}
