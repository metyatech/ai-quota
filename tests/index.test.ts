import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchAllRateLimits } from "../src/index.js";
import * as claude from "../src/claude.js";
import * as gemini from "../src/gemini.js";
import * as copilot from "../src/copilot.js";
import * as amazonQ from "../src/amazon-q.js";
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
    vi.spyOn(gemini, "fetchGeminiRateLimits").mockResolvedValue(null);
    vi.spyOn(copilot, "getCopilotToken").mockReturnValue("fake-token");
    vi.spyOn(copilot, "fetchCopilotRateLimits").mockRejectedValue(new Error("API Down"));
    vi.spyOn(amazonQ, "fetchAmazonQRateLimits").mockReturnValue({
      used: 5,
      limit: 50,
      percentRemaining: 90,
      resetAt: new Date(),
      periodKey: "2026-02"
    });
    vi.spyOn(codex, "fetchCodexRateLimits").mockResolvedValue(null);

    const result = await fetchAllRateLimits({ timeoutSeconds: 1 });

    expect(result.claude.status).toBe("ok");
    expect(result.gemini.status).toBe("no-data");
    expect(result.copilot.status).toBe("error");
    expect(result.amazonQ.status).toBe("ok");
    expect(result.codex.status).toBe("no-data");
  });

  it("handles missing Copilot token as no-data without timing out", async () => {
    vi.spyOn(claude, "fetchClaudeRateLimits").mockResolvedValue(null);
    vi.spyOn(gemini, "fetchGeminiRateLimits").mockResolvedValue(null);
    vi.spyOn(copilot, "getCopilotToken").mockReturnValue(null);
    vi.spyOn(amazonQ, "fetchAmazonQRateLimits").mockReturnValue({} as any);
    vi.spyOn(codex, "fetchCodexRateLimits").mockResolvedValue(null);

    const result = await fetchAllRateLimits({ timeoutSeconds: 1 });
    expect(result.copilot.status).toBe("no-data");
    expect(result.copilot.display).toContain("auth required");
  });

  it("respects AMAZON_Q_STATE_PATH environment variable", async () => {
    const customPath = "/custom/path/to/amazon-q-usage.json";
    process.env.AMAZON_Q_STATE_PATH = customPath;
    
    // Create a spy correctly
    const spy = vi.spyOn(amazonQ, "fetchAmazonQRateLimits").mockReturnValue({} as any);
    
    await fetchAllRateLimits({ agents: ["amazon-q"] });
    
    expect(spy).toHaveBeenCalledWith(customPath, expect.any(Number));
    delete process.env.AMAZON_Q_STATE_PATH;
  });

  it("selectively fetches only requested agents", async () => {
    const claudeSpy = vi.spyOn(claude, "fetchClaudeRateLimits").mockResolvedValue(null);
    const geminiSpy = vi.spyOn(gemini, "fetchGeminiRateLimits").mockResolvedValue(null);
    
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

  it("renders Amazon Q with percent used and reset time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-19T10:00:00Z"));

    vi.spyOn(amazonQ, "fetchAmazonQRateLimits").mockReturnValue({
      used: 2,
      limit: 50,
      percentRemaining: 96,
      resetAt: new Date("2026-03-01T00:00:00Z"),
      periodKey: "2026-02"
    });

    const result = await fetchAllRateLimits({ agents: ["amazon-q"] });
    expect(result.amazonQ.display).toBe("2/50 requests used (4% used, resets in 9d 14h)");
  });
});
