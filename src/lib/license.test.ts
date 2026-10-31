import { describe, expect, it } from "vitest";
import { evaluateLease, GRACE_SECS, type Lease } from "./license";

function lease(over: Partial<Lease> = {}): Lease {
  return {
    v: 2,
    product: "sorotin",
    key: "SRT-AAAA-BBBB-CCCC-DDDD",
    key_id: "DDDD",
    machine_id: "machine-1",
    token: "tok",
    seats: 1,
    last_ok: 1_000,
    issued_at: 1_000,
    expires_at: 10_000,
    ...over,
  };
}

describe("evaluateLease", () => {
  it("rejects a missing or foreign lease", () => {
    expect(evaluateLease(null).active).toBe(false);
    expect(evaluateLease(lease({ machine_id: "other" }), { machineId: "machine-1" }).reason).toMatch(/mesin/);
    expect(evaluateLease(lease({ token: "" }), { machineId: "machine-1" }).reason).toMatch(/lengkap/);
  });

  it("is active before expiry while last_ok is fresh", () => {
    const e = evaluateLease(lease(), { now: 1_100, machineId: "machine-1" });
    expect(e.active).toBe(true);
    expect(e.grace).toBe(false);
  });

  it("enters grace when the sheet has not been reached recently", () => {
    const last = 1_000;
    const e = evaluateLease(lease({ last_ok: last, expires_at: last + 30 * 86400 }), {
      now: last + 40 * 3600,
      machineId: "machine-1",
    });
    expect(e.active).toBe(true);
    expect(e.grace).toBe(true);
  });

  it("dies after expiry or after the offline window", () => {
    expect(evaluateLease(lease({ expires_at: 2_000 }), { now: 2_001, machineId: "machine-1" }).active).toBe(false);
    expect(
      evaluateLease(lease({ last_ok: 1_000, expires_at: 1_000 + GRACE_SECS + 50 }), {
        now: 1_000 + GRACE_SECS + 1,
        machineId: "machine-1",
      }).active,
    ).toBe(false);
  });
});
