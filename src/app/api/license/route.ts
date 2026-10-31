import { NextRequest, NextResponse } from "next/server";
import {
  activateLicense,
  deactivateLicense,
  heartbeatLicense,
  licenseStatus,
  loadLicenseFile,
  setLicenseServerUrl,
} from "@/lib/license";

export async function GET() {
  const file = loadLicenseFile();
  const status =
    file.lease && Date.now() / 1000 - (file.lease.last_ok || file.lease.issued_at) > 12 * 3600
      ? await heartbeatLicense()
      : licenseStatus();
  return NextResponse.json({ status: true, data: status });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    key?: string;
    serverUrl?: string;
  };
  try {
    if (body.action === "configure" && body.serverUrl) {
      return NextResponse.json({ status: true, data: setLicenseServerUrl(body.serverUrl) });
    }
    if (body.action === "activate") {
      if (!body.key?.trim()) {
        return NextResponse.json({ status: false, message: "Kunci lisensi kosong" }, { status: 400 });
      }
      const data = await activateLicense(body.key, body.serverUrl);
      return NextResponse.json({ status: true, data });
    }
    if (body.action === "heartbeat") {
      return NextResponse.json({ status: true, data: await heartbeatLicense() });
    }
    if (body.action === "deactivate") {
      return NextResponse.json({ status: true, data: await deactivateLicense() });
    }
    return NextResponse.json({ status: false, message: "action tidak dikenal" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { status: false, message: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
