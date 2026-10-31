import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { dataRoot } from "./store";
import { DEFAULT_LICENSE_URL } from "./license-pub";

export type Lease = {
  v: number;
  product: string;
  key: string;
  key_id: string;
  machine_id: string;
  token: string;
  seats: number;
  last_ok: number;
  issued_at: number;
  expires_at: number;
  grace_until?: number;
  label?: string;
};

export type LicenseFile = {
  serverUrl: string;
  lease?: Lease | null;
};

export type LicenseStatus = {
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

const PRODUCT = "sorotin";
export const GRACE_SECS = 7 * 24 * 3600;
const STALE_SECS = 36 * 3600;

export function licenseRequired() {
  if (process.env.SOROTIN_LICENSE_BYPASS === "1") return false;
  return process.env.SOROTIN_LICENSE_REQUIRED === "1" || process.env.SOROTIN_TAURI === "1";
}

export function machineId(): string {
  let raw = "";
  try {
    if (process.platform === "linux" && fs.existsSync("/etc/machine-id")) {
      raw = fs.readFileSync("/etc/machine-id", "utf8").trim();
    } else if (process.platform === "darwin" && fs.existsSync("/etc/hostid")) {
      raw = fs.readFileSync("/etc/hostid", "utf8").trim();
    }
  } catch {
    raw = "";
  }
  if (!raw) raw = `${os.hostname()}|${os.userInfo().username}|${os.homedir()}`;
  return createHash("sha256").update(`sorotin:${raw}`).digest("hex");
}

function licensePath() {
  return path.join(dataRoot(), "license.json");
}

export function loadLicenseFile(): LicenseFile {
  const fallback: LicenseFile = { serverUrl: DEFAULT_LICENSE_URL, lease: null };
  try {
    if (!fs.existsSync(licensePath())) return fallback;
    const raw = JSON.parse(fs.readFileSync(licensePath(), "utf8")) as LicenseFile;
    return {
      serverUrl: String(raw.serverUrl || DEFAULT_LICENSE_URL),
      lease: raw.lease ?? null,
    };
  } catch {
    return fallback;
  }
}

export function saveLicenseFile(next: LicenseFile) {
  const dir = dataRoot();
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${licensePath()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, licensePath());
}

function nowSecs() {
  return Math.floor(Date.now() / 1000);
}

export function evaluateLease(
  lease: Lease | null | undefined,
  opts?: { now?: number; machineId?: string },
): {
  active: boolean;
  grace: boolean;
  reason?: string;
} {
  const now = opts?.now ?? nowSecs();
  const mid = opts?.machineId ?? machineId();
  if (!lease) return { active: false, grace: false, reason: "belum diaktifkan" };
  if (lease.product !== PRODUCT) return { active: false, grace: false, reason: "produk tidak cocok" };
  if (!lease.token || !lease.key) return { active: false, grace: false, reason: "lease tidak lengkap" };
  if (lease.machine_id !== mid) return { active: false, grace: false, reason: "mesin tidak cocok" };
  if (now > lease.expires_at) return { active: false, grace: false, reason: "kunci kedaluwarsa" };
  const last = lease.last_ok || lease.issued_at || 0;
  if (now - last > GRACE_SECS) {
    return { active: false, grace: false, reason: "spreadsheet tidak terjangkau terlalu lama" };
  }
  const grace = now - last > STALE_SECS;
  return {
    active: true,
    grace,
    reason: grace ? "belum sinkron ke spreadsheet (masa tenggang)" : undefined,
  };
}

export function licenseStatus(): LicenseStatus {
  const file = loadLicenseFile();
  const required = licenseRequired();
  const evald = evaluateLease(file.lease ?? null);
  return {
    required,
    licensed: evald.active,
    active: required ? evald.active : true,
    grace: evald.grace,
    serverUrl: file.serverUrl,
    machineId: machineId(),
    keyId: file.lease?.key_id,
    expiresAt: file.lease?.expires_at,
    graceUntil: file.lease?.last_ok ? file.lease.last_ok + GRACE_SECS : undefined,
    reason: evald.reason,
  };
}

type ServerReply = { ok?: boolean; error?: string; lease?: Lease };

async function postScript(url: string, body: unknown): Promise<ServerReply> {
  if (!url.trim()) throw new Error("URL spreadsheet belum diisi");
  const r = await fetch(url.replace(/\/$/, ""), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  const text = await r.text();
  let j: ServerReply = {};
  try {
    j = JSON.parse(text) as ServerReply;
  } catch {
    throw new Error("jawaban bukan JSON — cek deployment Web app (Anyone)");
  }
  if (!r.ok || j.ok === false) throw new Error(j.error || `server ${r.status}`);
  return j;
}

function acceptLease(lease: Lease | undefined, mid: string): Lease {
  if (!lease?.token || !lease.key) throw new Error("spreadsheet tidak mengembalikan lease");
  if (lease.product !== PRODUCT) throw new Error("produk tidak cocok");
  if (lease.machine_id !== mid) throw new Error("mesin tidak cocok");
  return lease;
}

export async function activateLicense(key: string, serverUrl?: string): Promise<LicenseStatus> {
  const file = loadLicenseFile();
  const url = (serverUrl || file.serverUrl || DEFAULT_LICENSE_URL).replace(/\/$/, "");
  const mid = machineId();
  const j = await postScript(url, {
    action: "activate",
    key: key.trim(),
    machine_id: mid,
    hostname: os.hostname(),
    app_version: "0.1.0",
  });
  const lease = acceptLease(j.lease, mid);
  saveLicenseFile({ serverUrl: url, lease });
  return licenseStatus();
}

export async function heartbeatLicense(): Promise<LicenseStatus> {
  const file = loadLicenseFile();
  if (!file.lease) return licenseStatus();
  try {
    const j = await postScript(file.serverUrl, {
      action: "heartbeat",
      key: file.lease.key,
      machine_id: file.lease.machine_id,
      token: file.lease.token,
      hostname: os.hostname(),
    });
    if (j.lease) saveLicenseFile({ ...file, lease: acceptLease(j.lease, machineId()) });
  } catch {
    // keep stored lease; evaluateLease applies the offline window
  }
  return licenseStatus();
}

export async function deactivateLicense(): Promise<LicenseStatus> {
  const file = loadLicenseFile();
  if (file.lease) {
    try {
      await postScript(file.serverUrl, {
        action: "deactivate",
        key: file.lease.key,
        machine_id: file.lease.machine_id,
        token: file.lease.token,
        hostname: os.hostname(),
      });
    } catch {
      // still drop locally
    }
  }
  saveLicenseFile({ serverUrl: file.serverUrl, lease: null });
  return licenseStatus();
}

export function setLicenseServerUrl(serverUrl: string) {
  const file = loadLicenseFile();
  saveLicenseFile({ ...file, serverUrl: serverUrl.replace(/\/$/, "") });
  return licenseStatus();
}
