"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { LicensePanel } from "@/components/LicensePanel";

export default function ActivatePage() {
  const router = useRouter();
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const r = await fetch("/api/license");
      const j = await r.json();
      if (!alive) return;
      if (j.data?.licensed) router.replace("/");
    };
    void tick();
    const t = setInterval(() => void tick(), 2500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [router]);

  return (
    <AppShell>
      <div className="mx-auto max-w-xl pb-16 pt-10">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400/80">Lisensi</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-50">Aktifkan Sorotin</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Tempel kunci <code className="text-zinc-400">SRT-…</code> yang kamu terima.
        </p>
        <div className="mt-6">
          <LicensePanel compact />
        </div>
      </div>
    </AppShell>
  );
}
