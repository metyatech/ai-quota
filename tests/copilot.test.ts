import { describe, expect, it, vi, afterEach } from "vitest";
import {
  parseCopilotUserInfo,
  parseCopilotQuotaHeader,
  getCopilotToken
} from "../src/copilot.js";

describe("getCopilotToken", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("returns token from GITHUB_TOKEN environment variable", () => {
    process.env.GITHUB_TOKEN = "test-token";
    expect(getCopilotToken()).toBe("test-token");
  });

  it("returns null when no token source is available", () => {
    delete process.env.GITHUB_TOKEN;
    // Mock fs.existsSync to always return false
    vi.mock("node:fs", async () => {
      const actual = await vi.importActual("node:fs") as any;
      return {
        ...actual,
        default: { ...actual.default, existsSync: () => false },
        existsSync: () => false
      };
    });
    // Mock child_process.execSync to throw
    vi.mock("node:child_process", () => ({
      execSync: () => { throw new Error("not found"); }
    }));

    expect(getCopilotToken()).toBeNull();
  });
});

describe("parseCopilotUserInfo", () => {
  it("parses premium interactions snapshot", () => {
    const usage = parseCopilotUserInfo({
      quota_snapshots: {
        premium_interactions: {
          entitlement: 3000,
          percent_remaining: 72,
          overage_count: 1,
          overage_permitted: true
        }
      },
      quota_reset_date: "2026-02-15T00:00:00Z"
    });

    expect(usage).not.toBeNull();
    expect(usage?.percentRemaining).toBe(72);
    expect(usage?.entitlement).toBe(3000);
    expect(usage?.overageUsed).toBe(1);
    expect(usage?.overageEnabled).toBe(true);
    expect(usage?.source).toBe("user");
  });

  it("returns null when quota_snapshots is missing", () => {
    expect(parseCopilotUserInfo({ quota_reset_date: "2026-02-15T00:00:00Z" })).toBeNull();
  });

  it("returns null when premium_interactions is missing", () => {
    expect(
      parseCopilotUserInfo({
        quota_snapshots: { other: {} },
        quota_reset_date: "2026-02-15T00:00:00Z"
      })
    ).toBeNull();
  });

  it("returns null when quota_reset_date is missing", () => {
    expect(
      parseCopilotUserInfo({
        quota_snapshots: {
          premium_interactions: { entitlement: 3000, percent_remaining: 72 }
        }
      })
    ).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(parseCopilotUserInfo(null)).toBeNull();
    expect(parseCopilotUserInfo("string")).toBeNull();
    expect(parseCopilotUserInfo(42)).toBeNull();
  });

  it("clamps percentRemaining to [0, 100]", () => {
    const usage = parseCopilotUserInfo({
      quota_snapshots: {
        premium_interactions: { entitlement: 100, percent_remaining: 150 }
      },
      quota_reset_date: "2026-02-15T00:00:00Z"
    });
    expect(usage?.percentRemaining).toBe(100);
  });
});

describe("parseCopilotQuotaHeader", () => {
  it("parses quota header snapshot", () => {
    const usage = parseCopilotQuotaHeader(
      "ent=3000&rem=64&rst=2026-02-15T00:00:00Z&ov=0&ovPerm=false"
    );

    expect(usage).not.toBeNull();
    expect(usage?.percentRemaining).toBe(64);
    expect(usage?.entitlement).toBe(3000);
    expect(usage?.overageEnabled).toBe(false);
    expect(usage?.overageUsed).toBe(0);
    expect(usage?.source).toBe("header");
  });

  it("returns null for empty string", () => {
    expect(parseCopilotQuotaHeader("")).toBeNull();
    expect(parseCopilotQuotaHeader("   ")).toBeNull();
  });

  it("returns null when ent is missing", () => {
    expect(parseCopilotQuotaHeader("rem=64&rst=2026-02-15T00:00:00Z")).toBeNull();
  });

  it("returns null when rem is missing", () => {
    expect(parseCopilotQuotaHeader("ent=3000&rst=2026-02-15T00:00:00Z")).toBeNull();
  });

  it("infers reset date one month ahead when rst is missing", () => {
    const now = new Date("2026-02-02T00:00:00Z");
    const usage = parseCopilotQuotaHeader("ent=3000&rem=50", now);
    expect(usage).not.toBeNull();
    expect(usage?.resetAt.getMonth()).toBe(2); // March (0-indexed)
  });

  it("parses overage fields correctly", () => {
    const usage = parseCopilotQuotaHeader(
      "ent=1000&rem=30&rst=2026-03-01T00:00:00Z&ov=5&ovPerm=true"
    );
    expect(usage?.overageUsed).toBe(5);
    expect(usage?.overageEnabled).toBe(true);
  });
});
