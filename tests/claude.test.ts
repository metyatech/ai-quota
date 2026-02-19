import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fetchClaudeRateLimits } from "../src/claude.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("fetchClaudeRateLimits", () => {
  let tmpDir: string;
  let credentialsPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-quota-claude-"));
    process.env.USERPROFILE = tmpDir;
    process.env.HOME = tmpDir;
    credentialsPath = path.join(tmpDir, ".claude", ".credentials.json");
    fs.mkdirSync(path.dirname(credentialsPath), { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.USERPROFILE;
    delete process.env.HOME;
  });

  it("returns null when credentials file does not exist", async () => {
    fs.rmSync(credentialsPath, { force: true });
    const result = await fetchClaudeRateLimits();
    expect(result).toBeNull();
  });

  it("returns null when token is expired (expiresAt in the past)", async () => {
    const expiredAt = Date.now() - 1000;
    fs.writeFileSync(
      credentialsPath,
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "sk-ant-oat01-test",
          expiresAt: expiredAt
        }
      })
    );
    const result = await fetchClaudeRateLimits();
    expect(result).toBeNull();
  });

  it("returns null when token expires within the 5-minute buffer", async () => {
    const expiresAt = Date.now() + 60_000; // 1 minute from now
    fs.writeFileSync(
      credentialsPath,
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "sk-ant-oat01-test",
          expiresAt
        }
      })
    );
    const result = await fetchClaudeRateLimits();
    expect(result).toBeNull();
  });

  it("returns null when credentials JSON is malformed", async () => {
    fs.writeFileSync(credentialsPath, "not-json");
    const result = await fetchClaudeRateLimits();
    expect(result).toBeNull();
  });

  it("returns null when claudeAiOauth field is missing", async () => {
    fs.writeFileSync(credentialsPath, JSON.stringify({ other: "data" }));
    const result = await fetchClaudeRateLimits();
    expect(result).toBeNull();
  });

  it("returns null when accessToken is missing", async () => {
    fs.writeFileSync(
      credentialsPath,
      JSON.stringify({
        claudeAiOauth: {
          expiresAt: Date.now() + 3600_000
        }
      })
    );
    const result = await fetchClaudeRateLimits();
    expect(result).toBeNull();
  });

  it("fetches usage and parses response correctly", async () => {
    const expiresAt = Date.now() + 3600_000;
    fs.writeFileSync(
      credentialsPath,
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "sk-ant-oat01-valid",
          expiresAt
        }
      })
    );

    const mockResponse = {
      five_hour: { utilization: 40, resets_at: "2026-02-02T15:00:00Z" },
      seven_day: { utilization: 20, resets_at: "2026-02-08T00:00:00Z" },
      seven_day_sonnet: { utilization: 15, resets_at: "2026-02-08T00:00:00Z" },
      extra_usage: { is_enabled: false, monthly_limit: null, used_credits: 0, utilization: 0 }
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      })
    );

    const result = await fetchClaudeRateLimits();
    expect(result).not.toBeNull();
    expect(result?.five_hour?.utilization).toBe(40);
    expect(result?.seven_day?.utilization).toBe(20);
    expect(result?.seven_day_sonnet?.utilization).toBe(15);
    expect(result?.extra_usage?.is_enabled).toBe(false);
  });

  it("returns null when the API response is not ok", async () => {
    const expiresAt = Date.now() + 3600_000;
    fs.writeFileSync(
      credentialsPath,
      JSON.stringify({
        claudeAiOauth: { accessToken: "sk-ant-oat01-valid", expiresAt }
      })
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({ ok: false, status: 401 })
    );

    const result = await fetchClaudeRateLimits();
    expect(result).toBeNull();
  });
});
