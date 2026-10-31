import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

process.env.PERSONAL_CLIPPER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sorotin-guard-"));
delete process.env.SOROTIN_LICENSE_REQUIRED;
delete process.env.SOROTIN_TAURI;

import { POST as postExport } from "./export/route";
import { GET as getLicense, POST as postLicense } from "./license/route";
import { PUT as putSettings } from "./settings/route";
import { POST as postStudio } from "./studios/[id]/route";
import { PATCH as patchStudios, POST as postStudios } from "./studios/route";

function call(url: string, method: string, headers: Record<string, string>, body?: string) {
  return new NextRequest(url, { method, headers, body });
}

const evilJson = { origin: "https://evil.example", "content-type": "application/json" };

describe("guarded state-changing routes", () => {
  it("rejects a foreign Origin with 403", async () => {
    const cases: Array<[string, Response | Promise<Response>]> = [
      ["PUT /api/settings", putSettings(call("http://localhost:3000/api/settings", "PUT", evilJson, "{}"))],
      ["POST /api/studios", postStudios(call("http://localhost:3000/api/studios", "POST", evilJson, "{}"))],
      ["PATCH /api/studios", patchStudios(call("http://localhost:3000/api/studios", "PATCH", evilJson, "{}"))],
      [
        "POST /api/studios/[id]",
        postStudio(call("http://localhost:3000/api/studios/x", "POST", evilJson, '{"action":"reprocess"}'), {
          params: Promise.resolve({ id: "x" }),
        }),
      ],
      ["POST /api/export", postExport(call("http://127.0.0.1:17300/api/export", "POST", evilJson, "{}"))],
      ["GET /api/license", getLicense(call("http://127.0.0.1:17300/api/license", "GET", { origin: "https://evil.example" }))],
      ["POST /api/license", postLicense(call("http://127.0.0.1:17300/api/license", "POST", evilJson, "{}"))],
    ];
    for (const [name, pending] of cases) {
      const res = await pending;
      expect(res.status, name).toBe(403);
    }
  });

  it("rejects a non-JSON POST on /api/studios with 415", async () => {
    const res = await postStudios(
      call(
        "http://localhost:3000/api/studios",
        "POST",
        { origin: "http://localhost:3000", "content-type": "text/plain" },
        "{}",
      ),
    );
    expect(res.status).toBe(415);
  });

  it("rejects a non-JSON PUT on /api/settings with 415", async () => {
    const res = await putSettings(
      call(
        "http://localhost:3000/api/settings",
        "PUT",
        { origin: "http://127.0.0.1:3000", "content-type": "text/plain" },
        "{}",
      ),
    );
    expect(res.status).toBe(415);
  });

  it("accepts multipart on POST /api/studios and still requires a file", async () => {
    const boundary = "----sorotinboundary";
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n\r\n--${boundary}--\r\n`;
    const res = await postStudios(
      call(
        "http://localhost:3000/api/studios",
        "POST",
        {
          origin: "http://127.0.0.1:17300",
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      ),
    );
    expect(res.status).toBe(400);
    const payload = await res.json();
    expect(payload.message).toMatch(/file atau link/);
  });
});
