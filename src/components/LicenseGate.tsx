"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

const OPEN = new Set(["/activate"]);

export function LicenseGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    fetch("/api/license")
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        const d = j.data as { required?: boolean; active?: boolean };
        if (d?.required && !d.active && !OPEN.has(pathname)) router.replace("/activate");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pathname, router]);

  return <>{children}</>;
}
