"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { LicensePanel } from "@/components/LicensePanel";
import { Switch } from "@/components/Switch";
import { FamilyDot, ModelPicker, ProviderBadge } from "@/components/ModelPicker";
import { hideViaDuplicates, parseModel, recommendModels, type ModelInfo, type RawModel } from "@/lib/model-catalog";

type PublicSettings = {
  baseUrl: string;
  model: string;
  enabled: boolean;
  hasApiKey: boolean;
};

type TestResult = {
  baseUrl: string;
  endpoint: { ok: boolean; ms: number; modelCount?: number; error?: string };
  model?: { id: string; ok: boolean; ms: number; reply?: string; error?: string };
};

type ConnState = { kind: "checking" } | { kind: "online"; ms: number; count: number } | { kind: "offline"; error: string };

const REC_TONE: Record<string, string> = {
  smart: "text-orange-200",
  balanced: "text-emerald-200",
  fast: "text-sky-200",
  cheap: "text-amber-200",
};

function secs(ms: number) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} dtk`;
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url || "—";
  }
}

function StatusDot({ state }: { state: ConnState }) {
  const tone =
    state.kind === "online" ? "bg-emerald-400" : state.kind === "offline" ? "bg-red-400" : "bg-amber-300";
  return (
    <span className="relative flex h-2.5 w-2.5">
      {state.kind !== "offline" && (
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${tone}`} />
      )}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${tone}`} />
    </span>
  );
}

export default function SettingsPage() {
  const [saved, setSaved] = useState<PublicSettings | null>(null);
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:20128/v1");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [rawModels, setRawModels] = useState<RawModel[]>([]);
  const [conn, setConn] = useState<ConnState>({ kind: "checking" });
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const models = useMemo<ModelInfo[]>(() => rawModels.map(parseModel), [rawModels]);
  const recs = useMemo(() => recommendModels(models), [models]);
  const selected = models.find((m) => m.id === model);
  const uniqueCount = useMemo(() => hideViaDuplicates(models.filter((m) => m.chat)).length, [models]);

  const loadModels = useCallback(async (opts?: { baseUrl?: string; apiKey?: string; refresh?: boolean }) => {
    setConn({ kind: "checking" });
    try {
      const r = await fetch("/api/ai/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts || {}),
      });
      const j = await r.json();
      if (!r.ok || !j.status) throw new Error(j.message || "Endpoint tidak menjawab");
      const list = (j.data?.models || []) as RawModel[];
      setRawModels(list);
      setConn({ kind: "online", ms: j.data?.ms ?? 0, count: list.length });
    } catch (e) {
      setConn({ kind: "offline", error: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await fetch("/api/settings");
      const j = await r.json();
      const d = j.data as PublicSettings;
      if (!alive) return;
      setSaved(d);
      setBaseUrl(d.baseUrl);
      setModel(d.model);
      setEnabled(d.enabled);
      void loadModels();
    })();
    return () => {
      alive = false;
    };
  }, [loadModels]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(t);
  }, [toast]);

  const effectiveEnabled = enabled && Boolean(model);
  const dirty =
    !!saved &&
    (baseUrl !== saved.baseUrl || model !== saved.model || effectiveEnabled !== (saved.enabled && !!saved.model) || apiKey !== "");
  const endpointEdited = !!saved && (baseUrl !== saved.baseUrl || apiKey !== "");

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const r = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl, model, enabled: effectiveEnabled, ...(apiKey ? { apiKey } : {}) }),
      });
      const j = await r.json();
      if (!r.ok || !j.status) throw new Error(j.message || "Gagal simpan");
      const d = j.data as PublicSettings;
      setSaved(d);
      setBaseUrl(d.baseUrl);
      setModel(d.model);
      setEnabled(d.enabled);
      setApiKey("");
      const name = models.find((m) => m.id === d.model)?.name || d.model;
      setToast({
        tone: "ok",
        text: d.enabled && d.model ? `Tersimpan — ${name} dipakai untuk studio berikutnya` : "Tersimpan — AI ranking nonaktif (pakai ranking lokal)",
      });
    } catch (e) {
      setToast({ tone: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }, [apiKey, baseUrl, effectiveEnabled, model, models]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty && !saving) void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, save, saving]);

  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      const r = await fetch("/api/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl, ...(apiKey ? { apiKey } : {}), ...(model ? { model } : {}) }),
      });
      const j = await r.json();
      if (!r.ok || !j.status) throw new Error(j.message || "Tes koneksi gagal");
      const d = j.data as TestResult;
      setTest(d);
      if (d.endpoint.ok) {
        setConn({ kind: "online", ms: d.endpoint.ms, count: d.endpoint.modelCount ?? 0 });
        if (endpointEdited || !rawModels.length) void loadModels({ baseUrl, ...(apiKey ? { apiKey } : {}) });
      } else setConn({ kind: "offline", error: d.endpoint.error || "Offline" });
    } catch (e) {
      setConn({ kind: "offline", error: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  }

  function revert() {
    if (!saved) return;
    setBaseUrl(saved.baseUrl);
    setModel(saved.model);
    setEnabled(saved.enabled);
    setApiKey("");
    if (endpointEdited) {
      setTest(null);
      void loadModels();
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl pb-28 pt-6 sm:pt-10">
        <header className="mb-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400/80">Settings</p>
          <h1 className="mt-2 text-balance text-3xl font-semibold tracking-tight text-zinc-50">
            AI untuk <span className="text-emerald-400">ranking</span> clip
          </h1>
          <p className="mt-2 max-w-xl text-sm text-zinc-500">
            Model membaca transkrip, memilih clip, dan menulis judul hook. Kalau gagal, ranking lokal yang dipakai.
          </p>
        </header>

        <div className="space-y-5">
          {/* ── Koneksi ─────────────────────────────── */}
          <section className="panel p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-zinc-100">Koneksi endpoint</h2>
                <div className="mt-2 flex items-center gap-2.5 text-sm">
                  <StatusDot state={conn} />
                  {conn.kind === "online" && (
                    <span className="text-emerald-200">
                      Online <span className="text-zinc-500">· {conn.count} model · {secs(conn.ms)}</span>
                    </span>
                  )}
                  {conn.kind === "checking" && <span className="text-amber-200">Mengecek koneksi…</span>}
                  {conn.kind === "offline" && <span className="font-medium text-red-300">Offline</span>}
                  <code className="truncate rounded-md bg-white/[0.04] px-1.5 py-0.5 font-mono text-[11px] text-zinc-400">
                    {hostOf(baseUrl)}
                  </code>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void runTest()}
                disabled={testing || !baseUrl}
                className="btn btn-secondary"
              >
                {testing ? (
                  <>
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-500 border-t-emerald-300" />
                    Mengetes…
                  </>
                ) : (
                  "Tes koneksi"
                )}
              </button>
            </div>

            {conn.kind === "offline" && !test && (
              <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/[0.06] px-3.5 py-2.5 text-sm text-red-200">
                {conn.error}
              </p>
            )}

            {test && (
              <div className="mt-4 divide-y divide-white/5 overflow-hidden rounded-xl border border-white/[0.07] bg-black/30 text-sm">
                <div className="flex items-start gap-3 px-3.5 py-2.5">
                  <span className={test.endpoint.ok ? "text-emerald-300" : "text-red-300"}>
                    {test.endpoint.ok ? "✓" : "✕"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-zinc-200">
                      Endpoint {test.endpoint.ok ? "online" : "offline"}
                      <span className="ml-2 text-xs text-zinc-500">
                        {test.endpoint.ok ? `${test.endpoint.modelCount} model · ` : ""}
                        {secs(test.endpoint.ms)}
                      </span>
                    </div>
                    {test.endpoint.error && <div className="mt-0.5 text-xs text-red-300">{test.endpoint.error}</div>}
                  </div>
                </div>
                {test.endpoint.ok && !test.model && (
                  <div className="px-3.5 py-2.5 text-xs text-zinc-500">Pilih model di bawah untuk sekalian tes balasan model.</div>
                )}
                {test.model && (
                  <div className="flex items-start gap-3 px-3.5 py-2.5">
                    <span className={test.model.ok ? "text-emerald-300" : "text-red-300"}>{test.model.ok ? "✓" : "✕"}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-zinc-200">
                        Model {models.find((m) => m.id === test.model!.id)?.name || test.model.id}{" "}
                        {test.model.ok ? "menjawab" : "gagal"}
                        <span className="ml-2 text-xs text-zinc-500">{secs(test.model.ms)}</span>
                      </div>
                      {test.model.ok && test.model.reply && (
                        <code className="mt-1 block truncate font-mono text-[11px] text-zinc-500">{test.model.reply}</code>
                      )}
                      {test.model.error && <div className="mt-0.5 text-xs text-red-300">{test.model.error}</div>}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-medium text-zinc-400">Base URL</span>
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="http://127.0.0.1:20128/v1"
                  className="input mt-1.5 font-mono text-[13px]"
                  spellCheck={false}
                />
              </label>
              <label className="block">
                <span className="flex items-center gap-2 text-xs font-medium text-zinc-400">
                  API key
                  {saved?.hasApiKey && !apiKey && (
                    <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-300">tersimpan</span>
                  )}
                </span>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={saved?.hasApiKey ? "•••••••• (kosongkan = tetap)" : "sk-… / token 9router"}
                  className="input mt-1.5 font-mono text-[13px]"
                  autoComplete="off"
                />
              </label>
            </div>
            {endpointEdited && (
              <button
                type="button"
                onClick={() => void loadModels({ baseUrl, ...(apiKey ? { apiKey } : {}), refresh: true })}
                className="mt-3 text-xs font-medium text-emerald-300 hover:text-emerald-200"
              >
                ↻ Muat model dari endpoint baru
              </button>
            )}
          </section>

          {/* ── Model ─────────────────────────────── */}
          <section className="panel p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-zinc-100">Model</h2>
              {conn.kind === "online" && (
                <button
                  type="button"
                  onClick={() => void loadModels({ baseUrl, ...(apiKey ? { apiKey } : {}), refresh: true })}
                  className="text-xs text-zinc-500 hover:text-zinc-300"
                >
                  ↻ Muat ulang daftar
                </button>
              )}
            </div>

            <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Rekomendasi</p>
            <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
              {recs.length === 0 &&
                [0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-[92px] animate-pulse rounded-2xl border border-white/5 bg-white/[0.02]" />
                ))}
              {recs.map((r) => {
                const on = r.model.id === model;
                return (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => setModel(r.model.id)}
                    className={`group relative rounded-2xl border p-3.5 text-left transition ${
                      on
                        ? "border-emerald-400/50 bg-emerald-400/[0.07] ring-4 ring-emerald-400/10"
                        : "border-white/[0.07] bg-black/25 hover:border-white/15 hover:bg-white/[0.03]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${REC_TONE[r.key]}`}>
                        {r.label}
                      </span>
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded-full border text-[11px] ${
                          on ? "border-emerald-300 bg-emerald-400 text-[#04241a]" : "border-white/15 text-transparent"
                        }`}
                      >
                        ✓
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <FamilyDot family={r.model.family} />
                      <span className="text-sm font-semibold text-zinc-50">{r.model.name}</span>
                      <ProviderBadge m={r.model} />
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">{r.hint}</p>
                  </button>
                );
              })}
            </div>

            <div className="my-5 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
              <span className="h-px flex-1 bg-white/5" />
              atau cari dari {uniqueCount || "…"} model
              <span className="h-px flex-1 bg-white/5" />
            </div>

            <ModelPicker
              models={models}
              value={model}
              onChange={setModel}
              loading={conn.kind === "checking" && !models.length}
              disabled={conn.kind === "offline" && !models.length}
            />
            {model && !selected && models.length > 0 && (
              <p className="mt-2 text-xs text-amber-300/90">
                Model tersimpan <code className="font-mono">{model}</code> tidak ada di daftar endpoint sekarang.
              </p>
            )}
            {selected && (
              <p className="mt-2 text-xs text-zinc-500">
                Klik <span className="text-zinc-300">Tes koneksi</span> untuk cek model ini benar-benar menjawab.
              </p>
            )}
          </section>

          {/* ── Toggle ─────────────────────────────── */}
          <section className="panel p-5 sm:p-6">
            <div className="flex items-start justify-between gap-5">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Pakai AI untuk ranking clip</h2>
                <p className="mt-1 max-w-lg text-sm text-zinc-500">
                  {model
                    ? "Studio baru dan Reprocess minta model memilih clip dan judul hook. Gagal/timeout → fallback ke ranking lokal."
                    : "Pilih model dulu untuk mengaktifkan. Tanpa AI, clip dipilih dengan ranking lokal (jeda, kalimat utuh, hook)."}
                </p>
                <p className={`mt-2 text-xs font-medium ${effectiveEnabled ? "text-emerald-300" : "text-zinc-500"}`}>
                  {effectiveEnabled ? `Aktif · ${selected?.name || model}` : "Nonaktif · ranking lokal"}
                </p>
              </div>
              <Switch
                checked={effectiveEnabled}
                disabled={!model}
                onChange={setEnabled}
                label="Pakai AI untuk ranking clip"
              />
            </div>
          </section>

          <LicensePanel />

          <p className="px-1 text-xs text-zinc-600">
            Contoh 9router lokal: <code className="text-zinc-400">http://127.0.0.1:20128/v1</code>. Disimpan di{" "}
            <code className="text-zinc-400">data/settings.json</code> (tidak di-commit). Ctrl/⌘+S untuk simpan.
          </p>
        </div>
      </div>

      {/* Save bar */}
      <div
        className={`pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4 transition duration-200 ${
          dirty ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
        }`}
      >
        <div className="pointer-events-auto flex w-full max-w-3xl items-center gap-3 rounded-2xl border border-white/10 bg-[#0d1311]/90 px-4 py-3 shadow-2xl shadow-black/50 backdrop-blur-xl">
          <span className="h-2 w-2 shrink-0 rounded-full bg-amber-300" />
          <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">
            Perubahan belum disimpan
            {model !== saved?.model && selected ? <span className="text-zinc-500"> · model → {selected.name}</span> : null}
          </span>
          <button type="button" onClick={revert} disabled={saving} className="btn btn-ghost">
            Batal
          </button>
          <button type="button" onClick={() => void save()} disabled={saving || !dirty} className="btn btn-primary">
            {saving ? "Menyimpan…" : "Simpan"}
          </button>
        </div>
      </div>

      {toast && (
        <div className="fixed right-4 top-20 z-50 max-w-sm">
          <div
            className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-2xl backdrop-blur-xl ${
              toast.tone === "ok"
                ? "border-emerald-400/30 bg-emerald-950/80 text-emerald-100"
                : "border-red-400/30 bg-red-950/80 text-red-100"
            }`}
          >
            <span className="mt-0.5">{toast.tone === "ok" ? "✓" : "✕"}</span>
            <span>{toast.text}</span>
          </div>
        </div>
      )}
    </AppShell>
  );
}
