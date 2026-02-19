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
  });

  it("handles a mix of success, no-data, and errors", async () => {
    // Claude: Success
    vi.spyOn(claude, "fetchClaudeRateLimits").mockResolvedValue({
      five_hour: { utilization: 10, resets_at: new Date().toISOString() },
      seven_day: null,
      seven_day_sonnet: null,
      extra_usage: null
    });

    // Gemini: No data
    vi.spyOn(gemini, "fetchGeminiRateLimits").mockResolvedValue(null);

    // Copilot: Error
    vi.spyOn(copilot, "getCopilotToken").mockReturnValue("fake-token");
    vi.spyOn(copilot, "fetchCopilotRateLimits").mockRejectedValue(new Error("API Down"));

    // Amazon Q: Success
    vi.spyOn(amazonQ, "fetchAmazonQRateLimits").mockReturnValue({
      used: 5,
      limit: 50,
      percentRemaining: 90,
      resetAt: new Date(),
      periodKey: "2026-02"
    });

    // Codex: No data
    vi.spyOn(codex, "fetchCodexRateLimits").mockResolvedValue(null);

    const result = await fetchAllRateLimits();

    expect(result.claude.status).toBe("ok");
    expect(result.claude.display).toContain("10%");
    
    expect(result.gemini.status).toBe("no-data");
    
    expect(result.copilot.status).toBe("error");
    expect(result.copilot.error).toContain("API Down");
    
    expect(result.amazonQ.status).toBe("ok");
    expect(result.amazonQ.display).toBe("5/50 requests used");
    
    expect(result.codex.status).toBe("no-data");
  });

  it("handles missing Copilot token as no-data", async () => {
    vi.spyOn(copilot, "getCopilotToken").mockReturnValue(null);
    const result = await fetchAllRateLimits();
    expect(result.copilot.status).toBe("no-data");
    expect(result.copilot.display).toContain("auth required");
  });
});
