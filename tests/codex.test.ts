import { describe, expect, it, beforeEach, afterEach } from "vitest";
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

  it("returns null when both windows have no valid resetAt", () => {
    const now = new Date("2026-02-02T10:00:00Z");
    // No resetsAt and no windowDurationMins
    const snapshot = {
      primary: { used_percent: 50 },
      secondary: { used_percent: 30 }
    };
    // With no windowDurationMins and no resetsAt, resetAt will fall back to null
    // but used_percent is valid so the window normalizes. Actually resetAt will be
    // null since neither resetsAt nor windowMinutes is provided, so windows array is empty.
    const status = rateLimitSnapshotToStatus(snapshot, now);
    // The status may be null if no resetAt can be determined for any window
    // Since resetsAt is not set and windowDurationMins is not set, resetAt is null,
    // so no windows are pushed.
    expect(status).toBeNull();
  });

  it("returns null when snapshot has no valid windows", () => {
    const status = rateLimitSnapshotToStatus({ primary: null, secondary: null });
    expect(status).toBeNull();
  });

  it("assigns lone window with large duration to weekly slot", () => {
    const now = new Date("2026-02-02T10:00:00Z");
    const snapshot = {
      primary: {
        usedPercent: 25,
        windowDurationMins: 10080, // 7 days
        resetsAt: Math.floor(now.getTime() / 1000) + 86400
      }
    };
    const status = rateLimitSnapshotToStatus(snapshot, now);
    expect(status).not.toBeNull();
    const weekly = status?.windows.find((w) => w.key === "weekly");
    expect(weekly).toBeDefined();
    expect(weekly?.percentLeft).toBe(75);
  });

  it("assigns lone window with small duration to fiveHour slot", () => {
    const now = new Date("2026-02-02T10:00:00Z");
    const snapshot = {
      secondary: {
        usedPercent: 60,
        windowDurationMins: 300,
        resetsAt: Math.floor(now.getTime() / 1000) + 3600
      }
    };
    const status = rateLimitSnapshotToStatus(snapshot, now);
    expect(status).not.toBeNull();
    const fiveHour = status?.windows.find((w) => w.key === "fiveHour");
    expect(fiveHour).toBeDefined();
    expect(fiveHour?.percentLeft).toBe(40);
  });

  it("clamps percentLeft to [0, 100]", () => {
    const now = new Date("2026-02-02T10:00:00Z");
    const snapshot = {
      primary: {
        usedPercent: 110, // over 100
        windowDurationMins: 300,
        resetsAt: Math.floor(now.getTime() / 1000) + 3600
      }
    };
    const status = rateLimitSnapshotToStatus(snapshot, now);
    const fiveHour = status?.windows.find((w) => w.key === "fiveHour");
    expect(fiveHour?.percentLeft).toBe(0);
  });
});

describe("fetchCodexRateLimits – JSONL session files", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ai-quota-codex-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns null when codexHome does not exist", async () => {
    const result = await fetchCodexRateLimits({ codexHome: join(tmpDir, "nonexistent") });
    expect(result).toBeNull();
  });

  it("reads rate limits from the most recent JSONL session file", async () => {
    // Use the actual current date so the session directory matches what the
    // production code looks for (it calls `new Date()` internally).
    const now = new Date();
    const yyyy = now.getFullYear().toString();
    const mm = (now.getMonth() + 1).toString().padStart(2, "0");
    const dd = now.getDate().toString().padStart(2, "0");
    const dayDir = join(tmpDir, "sessions", yyyy, mm, dd);
    await mkdir(dayDir, { recursive: true });

    const entry = {
      payload: {
        type: "token_count",
        info: {
          rate_limits: {
            primary: { used_percent: 35, window_duration_minutes: 300, resets_in_seconds: 1800 },
            secondary: {
              used_percent: 15,
              window_duration_minutes: 10080,
              resets_in_seconds: 86400
            }
          }
        }
      }
    };
    await writeFile(join(dayDir, "session-001.jsonl"), JSON.stringify(entry) + "\n");

    const result = await fetchCodexRateLimits({ codexHome: tmpDir });
    expect(result).not.toBeNull();
    expect(result?.primary?.used_percent).toBe(35);
    expect(result?.secondary?.used_percent).toBe(15);
  });

  it("reads rate limits from modern wrapped event_msg format", async () => {
    const now = new Date();
    const yyyy = now.getFullYear().toString();
    const mm = (now.getMonth() + 1).toString().padStart(2, "0");
    const dd = now.getDate().toString().padStart(2, "0");
    const dayDir = join(tmpDir, "sessions", yyyy, mm, dd);
    await mkdir(dayDir, { recursive: true });

    // The modern format found during debugging
    const entry = {
      timestamp: now.toISOString(),
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          rate_limits: {
            primary: { used_percent: 65, window_minutes: 300, resets_at: 1771505456 },
            secondary: { used_percent: 21, window_minutes: 10080, resets_at: 1772067074 }
          }
        }
      }
    };
    await writeFile(join(dayDir, "rollout-modern.jsonl"), JSON.stringify(entry) + "\n");

    const result = await fetchCodexRateLimits({ codexHome: tmpDir });
    expect(result).not.toBeNull();
    expect(result?.primary?.used_percent).toBe(65);
    expect(result?.secondary?.used_percent).toBe(21);
    expect(result?.primary?.window_minutes).toBe(300);
  });

  it("skips JSONL lines that are not token_count type", async () => {
    const now = new Date();
    const yyyy = now.getFullYear().toString();
    const mm = (now.getMonth() + 1).toString().padStart(2, "0");
    const dd = now.getDate().toString().padStart(2, "0");
    const dayDir = join(tmpDir, "sessions", yyyy, mm, dd);
    await mkdir(dayDir, { recursive: true });

    const otherEntry = { payload: { type: "other_event", info: {} } };
    await writeFile(join(dayDir, "session-001.jsonl"), JSON.stringify(otherEntry) + "\n");

    const result = await fetchCodexRateLimits({ codexHome: tmpDir });
    // No token_count entries → falls back to API (which also fails) → null
    expect(result).toBeNull();
  });
});
