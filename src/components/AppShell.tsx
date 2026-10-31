"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Studio" },
  { href: "/settings", label: "Settings" },
];

export function AppShell({
  children,
  title,
  actions,
}: {
  children: React.ReactNode;
  title?: string;
  actions?: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 border-b border-white/5 bg-[#0A0F0D]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Link href="/" aria-label="Sorotin — beranda" className="flex items-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- static SVG wordmark */}
              <img src="/brand/sorotin-logo.svg" alt="Sorotin" width={101} height={28} className="hidden h-7 w-auto sm:block" />
              {/* eslint-disable-next-line @next/next/no-img-element -- static SVG mark */}
              <img src="/brand/sorotin-mark.svg" alt="Sorotin" width={28} height={28} className="h-7 w-7 sm:hidden" />
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              {NAV.map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`rounded-lg px-3 py-1.5 transition ${
                      active ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            {title ? <span className="hidden text-sm text-zinc-400 md:inline">{title}</span> : null}
            {actions}
          </div>
        </div>
      </header>
      <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-4 sm:px-6 sm:py-6">{children}</div>
    </div>
  );
}
