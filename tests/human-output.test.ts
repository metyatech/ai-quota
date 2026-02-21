import { describe, expect, it } from "vitest";
import type { AllRateLimits } from "../src/types.js";
import { buildHumanRows, formatHumanTable } from "../src/human-output.js";

function makeEmptyResults(): AllRateLimits {
  return {
    summary: { status: "healthy", message: "ok" },
    claude: { status: "no-data", data: null, reason: "no_credentials", error: null, display: "no data" },
    gemini: { status: "no-data", data: null, reason: "no_credentials", error: null, display: "no data" },
    copilot: { status: "no-data", data: null, reason: "no_credentials", error: null, display: "no data" },
    codex: { status: "no-data", data: null, reason: "no_credentials", error: null, display: "no data" }
  };
}

describe("human output", () => {
  it("codex 5h 0% + 7d 100% => WAIT_RESET, LIMIT=7d, details order 7d then 5h", () => {
    const now = new Date("2026-02-19T10:00:00Z");

    const all = makeEmptyResults();
    all.codex = {
      status: "ok",
      reason: null,
      error: null,
      display: "ignored",
      data: {
        primary: {
          used_percent: 0,
          windowDurationMins: 300,
          resetsAt: Math.floor(new Date("2026-02-19T11:00:00Z").getTime() / 1000)
        },
        secondary: {
          used_percent: 100,
          windowDurationMins: 10080,
          resetsAt: Math.floor(new Date("2026-02-26T10:00:00Z").getTime() / 1000)
        }
      }
    };

    const rows = buildHumanRows(all, { agents: ["codex"], now });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.agent).toBe("codex");
    expect(rows[0]?.status).toBe("WAIT_RESET");
    expect(rows[0]?.limit).toBe("7d");
    expect(rows[0]?.details.indexOf("7d:")).toBeGreaterThanOrEqual(0);
    expect(rows[0]?.details.indexOf("5h:")).toBeGreaterThanOrEqual(0);
    expect(rows[0]!.details.indexOf("7d:")).toBeLessThan(rows[0]!.details.indexOf("5h:"));

    const table = formatHumanTable(rows);
    expect(table).toContain("AGENT");
    expect(table).toContain("STATUS");
    expect(table).toContain("LIMIT");
    expect(table).toContain("DETAILS");
    expect(table).toContain("codex");
    expect(table).toContain("WAIT_RESET");
  });

  it("claude with both 7d buckets labels all models vs sonnet only (stable tie-break)", () => {
    const now = new Date("2026-02-19T10:00:00Z");

    const all = makeEmptyResults();
    all.claude = {
      status: "ok",
      reason: null,
      error: null,
      display: "ignored",
      data: {
        five_hour: { utilization: 10, resets_at: "2026-02-19T12:00:00Z" },
        seven_day: { utilization: 50, resets_at: "2026-02-25T10:00:00Z" },
        seven_day_sonnet: { utilization: 50, resets_at: "2026-02-25T10:00:00Z" },
        extra_usage: null
      }
    };

    const rows = buildHumanRows(all, { agents: ["claude"], now });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.agent).toBe("claude");
    expect(rows[0]?.details).toContain("(all models)");
    expect(rows[0]?.details).toContain("(sonnet only)");
    expect(rows[0]!.details.indexOf("(all models)")).toBeLessThan(rows[0]!.details.indexOf("(sonnet only)"));
  });

  it("claude with only all-models 7d keeps legacy details (no suffix)", () => {
    const now = new Date("2026-02-19T10:00:00Z");

    const all = makeEmptyResults();
    all.claude = {
      status: "ok",
      reason: null,
      error: null,
      display: "ignored",
      data: {
        five_hour: { utilization: 10, resets_at: "2026-02-19T12:00:00Z" },
        seven_day: { utilization: 22, resets_at: "2026-02-25T10:00:00Z" },
        seven_day_sonnet: null,
        extra_usage: null
      }
    };

    const rows = buildHumanRows(all, { agents: ["claude"], now });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.details).toContain("7d: 22% used");
    expect(rows[0]?.details).not.toContain("all models");
    expect(rows[0]?.details).not.toContain("sonnet only");
  });
});
