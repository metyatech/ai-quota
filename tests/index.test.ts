import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchAllRateLimits } from "../src/index.js";
import { QuotaFetchError } from "../src/errors.js";
import * as claude from "../src/claude.js";
import * as gemini from "../src/gemini.js";
import * as copilot from "../src/copilot.js";
import * as codex from "../src/codex.js";

describe("fetchAllRateLimits", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("handles a mix of success, no-data, and errors", async () => {
    vi.spyOn(claude, "fetchClaudeRateLimits").mockResolvedValue({
      five_hour: { utilization: 10, resets_at: new Date().toISOString() },
      seven_day: null,
      seven_day_sonnet: null,
      extra_usage: null
    });
    vi.spyOn(gemini, "fetchGeminiRateLimits").mockRejectedValue(
      new QuotaFetchError("no_credentials", "missing creds")
    );
    vi.spyOn(copilot, "getCopilotToken").mockReturnValue("fake-token");
    vi.spyOn(copilot, "fetchCopilotRateLimits").mockRejectedValue(
      new QuotaFetchError("api_error", "API Down")
    );
    vi.spyOn(codex, "fetchCodexRateLimits").mockRejectedValue(
      new QuotaFetchError("no_credentials", "missing auth.json")
    );

    const result = await fetchAllRateLimits({ timeoutSeconds: 1 });

    expect(result.claude.status).toBe("ok");
    expect(result.gemini.status).toBe("no-data");
    expect(result.gemini.reason).toBe("no_credentials");
    expect(result.copilot.status).toBe("error");
    expect(result.copilot.reason).toBe("api_error");
    expect(result.codex.status).toBe("no-data");
    expect(result.codex.reason).toBe("no_credentials");
  });

  it("handles missing Copilot token as no-data", async () => {
    vi.spyOn(copilot, "getCopilotToken").mockReturnValue(null);

    const result = await fetchAllRateLimits({ agents: ["copilot"], timeoutSeconds: 1 });
    expect(result.copilot.status).toBe("no-data");
    expect(result.copilot.reason).toBe("no_credentials");
    expect(result.copilot.display).toContain("no data");
  });

  it("selectively fetches only requested agents", async () => {
    const claudeSpy = vi.spyOn(claude, "fetchClaudeRateLimits").mockRejectedValue(
      new QuotaFetchError("no_credentials", "missing creds")
    );
    const geminiSpy = vi.spyOn(gemini, "fetchGeminiRateLimits").mockRejectedValue(
      new QuotaFetchError("no_credentials", "missing creds")
    );

    const result = await fetchAllRateLimits({ agents: ["claude"] });

    expect(claudeSpy).toHaveBeenCalled();
    expect(geminiSpy).not.toHaveBeenCalled();

    expect(result.gemini.display).toBe("skipped");
    expect(result.gemini.status).toBe("no-data");
  });

  it("renders percentages as '% used' and formats days in reset durations", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-19T10:00:00Z"));

    vi.spyOn(claude, "fetchClaudeRateLimits").mockResolvedValue({
      five_hour: { utilization: 10, resets_at: "2026-02-19T12:11:00Z" },
      seven_day: { utilization: 22, resets_at: "2026-02-25T02:11:00Z" },
      seven_day_sonnet: null,
      extra_usage: null
    });

    const result = await fetchAllRateLimits({ agents: ["claude"] });
    expect(result.claude.display).toBe(
      "5h: 10% used (resets in 2h 11m), 7d: 22% used (resets in 5d 16h 11m)"
    );
  });

  it("uses the maximum percent across all windows for summary stress", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-19T10:00:00Z"));

    vi.spyOn(claude, "fetchClaudeRateLimits").mockResolvedValue({
      five_hour: { utilization: 10, resets_at: "2026-02-19T12:11:00Z" },
      seven_day: { utilization: 90, resets_at: "2026-02-25T02:11:00Z" },
      seven_day_sonnet: null,
      extra_usage: null
    });

    const result = await fetchAllRateLimits({ agents: ["claude"] });
    expect(result.summary.status).toBe("warning");
    expect(result.summary.message).toContain("90");
  });

  it("includes 'used' labels for Gemini models (order-independent)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-19T10:00:00Z"));

    vi.spyOn(gemini, "fetchGeminiRateLimits").mockResolvedValue({
      "gemini-3-flash-preview": {
        limit: 100,
        usage: 85,
        resetAt: new Date("2026-02-19T19:49:00Z")
      },
      "gemini-3-pro-preview": {
        limit: 100,
        usage: 8,
        resetAt: new Date("2026-02-19T19:45:00Z")
      }
    });

    const result = await fetchAllRateLimits({ agents: ["gemini"] });
    expect(result.gemini.display).toContain("flash: 85% used (resets in 9h 49m)");
    expect(result.gemini.display).toContain("pro: 8% used (resets in 9h 45m)");
  });

  it("renders Codex weekly window as '7d' and labels percentages as used", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-19T10:00:00Z"));

    vi.spyOn(codex, "fetchCodexRateLimits").mockResolvedValue({
      primary: {
        used_percent: 64,
        windowDurationMins: 300,
        resetsAt: Math.floor(new Date("2026-02-19T11:02:00Z").getTime() / 1000)
      },
      secondary: {
        used_percent: 44,
        windowDurationMins: 10080,
        resetsAt: Math.floor(new Date("2026-02-25T18:02:00Z").getTime() / 1000)
      }
    });

    const result = await fetchAllRateLimits({ agents: ["codex"] });
    expect(result.codex.display).toBe(
      "5h: 64% used (resets in 1h 2m), 7d: 44% used (resets in 6d 8h 2m)"
    );
  });
});

