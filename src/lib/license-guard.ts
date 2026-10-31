import { NextResponse } from "next/server";
import { licenseStatus } from "./license";

export function denyIfUnlicensed() {
  const s = licenseStatus();
  if (!s.required || s.active) return null;
  return NextResponse.json(
    { status: false, message: s.reason || "Lisensi tidak aktif", code: "unlicensed" },
    { status: 403 },
  );
}
