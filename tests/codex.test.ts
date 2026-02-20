import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rateLimitSnapshotToStatus, fetchCodexRateLimits } from "../src/codex.js";

describe("rateLimitSnapshotToStatus", () => {
  it("maps primary/secondary windows to 5h and weekly usage", () => {
    const now = new Date("2026-02-02T10:00:00Z");
    const snapshot = {
      primary: {
        usedPercent: 40,
        windowDurationMins: 300,
        resetsAt: 1_770_020_000
      },
      secondary: {
        usedPercent: 10,
        windowDurationMins: 10080,
        resetsAt: 1_770_120_000
      }
    };

    const status = rateLimitSnapshotToStatus(snapshot, now);
    expect(status).not.toBeNull();
    const fiveHour = status?.windows.find((w) => w.key === "fiveHour");
    const weekly = status?.windows.find((w) => w.key === "weekly");

    expect(fiveHour?.percentLeft).toBe(60);
    expect(weekly?.percentLeft).toBe(90);
  });

  it("returns null when snapshot has no valid windows", () => {
    const status = rateLimitSnapshotToStatus({ primary: null, secondary: null });
    expect(status).toBeNull();
  });
});

describe("fetchCodexRateLimits – remote API only", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ai-quota-codex-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("throws no_credentials when auth.json is missing", async () => {
    await expect(fetchCodexRateLimits({ codexHome: tmpDir })).rejects.toMatchObject({
      name: "QuotaFetchError",
      reason: "no_credentials"
    });
  });

  it("calls remote endpoint and parses rate_limits", async () => {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      join(tmpDir, "auth.json"),
      JSON.stringify({ tokens: { access_token: "tok" } }),
      "utf8"
    );

    const fetchSpy = vi.spyOn(globalThis, "fetch" as any).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () =>
        JSON.stringify({
          rate_limits: {
            primary: { used_percent: 10, limit_window_seconds: 300 * 60, reset_after_seconds: 60 },
            secondary: { used_percent: 20, limit_window_seconds: 10080 * 60, reset_after_seconds: 120 }
          }
        })
    } as any);

    const result = await fetchCodexRateLimits({ codexHome: tmpDir, timeoutSeconds: 1 });
    expect(result.primary?.used_percent).toBe(10);
    expect(result.secondary?.used_percent).toBe(20);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("throws endpoint_changed on 404", async () => {
    await writeFile(
      join(tmpDir, "auth.json"),
      JSON.stringify({ tokens: { access_token: "tok" } }),
      "utf8"
    );

    vi.spyOn(globalThis, "fetch" as any).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "nope"
    } as any);

    await expect(fetchCodexRateLimits({ codexHome: tmpDir, timeoutSeconds: 1 })).rejects.toMatchObject(
      { name: "QuotaFetchError", reason: "endpoint_changed" }
    );
  });
});

