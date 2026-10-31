import { NextResponse } from "next/server";

/**
 * Origins the Sorotin window actually runs on.
 *
 * - `http://localhost:3000` and `http://127.0.0.1:3000`: `pnpm dev`.
 * - `http://127.0.0.1:17300`: the Tauri production webview after it navigates
 *   to the sidecar (`src-tauri/src/lib.rs`).
 * - `tauri://localhost`: Tauri 2 custom protocol on Linux and macOS.
 * - `http://tauri.localhost`: Tauri 2 default on Windows and Android
 *   (`app.windows.useHttpsScheme` defaults to false; see tauri.conf schema).
 * - `https://tauri.localhost`: the same platforms when `useHttpsScheme` is on.
 *   This app does not set that flag; the origin is allowed so turning it on
 *   does not 403 the shell. The splash page does not call the API.
 */
export const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:17300",
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
] as const;

const ALLOWED = new Set<string>(ALLOWED_ORIGINS);

/**
 * Missing Origin:
 * A present Origin must be on the allowlist. The opaque origin `null` is rejected.
 * Browsers send Origin on POST (including a cross-site `text/plain` form). A
 * cross-site no-cors GET can omit Origin, but still sends the forbidden header
 * `Sec-Fetch-Site: cross-site`, which is rejected.
 * No Origin and no cross-site `Sec-Fetch-Site` is allowed. That is curl and
 * other non-browser clients (`scripts/verify-desktop.sh`). A website cannot
 * strip either header.
 */
export function isAllowedOrigin(origin: string): boolean {
  const value = origin.trim();
  if (!value || value.toLowerCase() === "null") return false;
  if (ALLOWED.has(value)) return true;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return false;
    if (url.pathname !== "/" && url.pathname !== "") return false;
    if (url.protocol === "tauri:") return url.hostname === "localhost" && url.port === "";
    return ALLOWED.has(`${url.protocol}//${url.host}`);
  } catch {
    return false;
  }
}

function mediaType(header: string | null): string {
  if (!header) return "";
  return header.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export type GuardOptions = {
  /** POST /api/studios accepts a video upload as multipart/form-data. */
  allowMultipart?: boolean;
};

/** 403 for a foreign browser call, 415 when a mutation is not JSON (or multipart). */
export function guardApiRequest(req: Request, opts?: GuardOptions): NextResponse | null {
  const origin = req.headers.get("origin");
  if (origin !== null) {
    if (!isAllowedOrigin(origin)) {
      return NextResponse.json({ status: false, message: "Origin ditolak" }, { status: 403 });
    }
  } else if ((req.headers.get("sec-fetch-site") || "").trim().toLowerCase() === "cross-site") {
    return NextResponse.json({ status: false, message: "Origin ditolak" }, { status: 403 });
  }

  const method = req.method.toUpperCase();
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    const type = mediaType(req.headers.get("content-type"));
    if (opts?.allowMultipart && type === "multipart/form-data") return null;
    if (type !== "application/json") {
      return NextResponse.json(
        { status: false, message: "Content-Type harus application/json" },
        { status: 415 },
      );
    }
  }
  return null;
}
