"use client";

import { useCallback, useEffect, useState } from "react";

type Status = {
  required: boolean;
  active: boolean;
  licensed: boolean;
  grace: boolean;
  serverUrl: string;
  machineId: string;
  keyId?: string;
  expiresAt?: number;
  graceUntil?: number;
  reason?: string;
};

function fmt(ts?: number) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("id-ID");
}

export function LicensePanel({ compact = false }: { compact?: boolean }) {
  const [s, setS] = useState<Status | null>(null);
  const [serverUrl, setServerUrl] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const r = await fetch("/api/license");
    const j = await r.json();
    const d = j.data as Status;
    setS(d);
    setServerUrl((cur) => cur || d.serverUrl || "");
  }, []);

  useEffect(() => {
    let alive = true;
    const boot = window.setTimeout(() => {
      if (!alive) return;
      void refresh();
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(boot);
    };
  }, [refresh]);

  async function post(body: Record<string, string>) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || !j.status) throw new Error(j.message || "Gagal");
      setS(j.data);
      if (j.data?.serverUrl) setServerUrl(j.data.serverUrl);
      setKey("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!s) return <div className="h-24 animate-pulse rounded-2xl border border-white/5 bg-white/[0.02]" />;

  return (
    <section className="panel p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Lisensi</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Kunci dari menu <span className="text-zinc-400">Sorotin → Kunci baru</span> di spreadsheet. Aktivasi
            tercatat di tab Lisensi dan Log.
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            s.licensed
              ? s.grace
                ? "bg-amber-300/10 text-amber-200"
                : "bg-emerald-400/10 text-emerald-300"
              : s.required
                ? "bg-red-400/10 text-red-300"
                : "bg-white/5 text-zinc-400"
          }`}
        >
          {s.licensed ? (s.grace ? "Masa tenggang" : "Aktif") : s.required ? "Belum aktif" : "Tidak diwajibkan"}
        </span>
      </div>

      {s.reason && s.required && <p className="mt-3 text-sm text-amber-200/90">{s.reason}</p>}
      {error && (
        <p className="mt-3 rounded-xl border border-red-400/20 bg-red-400/[0.06] px-3.5 py-2.5 text-sm text-red-200">
          {error}
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-zinc-400">Server lisensi</span>
          <input
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="https://script.google.com/macros/s/…/exec"
            className="input mt-1.5 font-mono text-[13px]"
            spellCheck={false}
          />
        </label>
        {!s.licensed && (
          <label className="block">
            <span className="text-xs font-medium text-zinc-400">Kunci</span>
            <input
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
              placeholder="SRT-XXXX-XXXX-XXXX-XXXX"
              className="input mt-1.5 font-mono text-[13px]"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {!s.licensed ? (
          <button
            type="button"
            disabled={busy || !key.trim() || !serverUrl.trim()}
            className="btn btn-primary"
            onClick={() => void post({ action: "activate", key, serverUrl })}
          >
            {busy ? "Mengaktifkan…" : "Aktifkan"}
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              className="btn btn-secondary"
              onClick={() => void post({ action: "heartbeat" })}
            >
              Cek ulang
            </button>
            <button
              type="button"
              disabled={busy}
              className="btn btn-danger"
              onClick={() => void post({ action: "deactivate" })}
            >
              Lepas mesin ini
            </button>
          </>
        )}
        <button
          type="button"
          disabled={busy || !serverUrl.trim()}
          className="btn btn-ghost"
          onClick={() => void post({ action: "configure", serverUrl })}
        >
          Simpan URL
        </button>
      </div>

      {!compact && (
        <dl className="mt-5 grid gap-2 font-mono text-[11px] text-zinc-500 sm:grid-cols-2">
          <div>
            <dt className="text-zinc-600">Mesin</dt>
            <dd className="truncate text-zinc-400" title={s.machineId}>
              {s.machineId.slice(0, 16)}…
            </dd>
          </div>
          <div>
            <dt className="text-zinc-600">Key id</dt>
            <dd>{s.keyId || "—"}</dd>
          </div>
          <div>
            <dt className="text-zinc-600">Lease sampai</dt>
            <dd>{fmt(s.expiresAt)}</dd>
          </div>
          <div>
            <dt className="text-zinc-600">Tenggang sampai</dt>
            <dd>{fmt(s.graceUntil)}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
