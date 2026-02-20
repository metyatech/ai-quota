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

  it("throws no_credentials when credentials file does not exist", async () => {
    fs.rmSync(credentialsPath, { force: true });
    await expect(fetchClaudeRateLimits()).rejects.toMatchObject({
      name: "QuotaFetchError",
      reason: "no_credentials"
    });
  });

  it("throws token_expired when token is expired (expiresAt in the past)", async () => {
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
    await expect(fetchClaudeRateLimits()).rejects.toMatchObject({
      name: "QuotaFetchError",
      reason: "token_expired"
    });
  });

  it("throws token_expired when token expires within the 5-minute buffer", async () => {
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
    await expect(fetchClaudeRateLimits()).rejects.toMatchObject({
      name: "QuotaFetchError",
      reason: "token_expired"
    });
  });

  it("throws parse_error when credentials JSON is malformed", async () => {
    fs.writeFileSync(credentialsPath, "not-json");
    await expect(fetchClaudeRateLimits()).rejects.toMatchObject({
      name: "QuotaFetchError",
      reason: "parse_error"
    });
  });

  it("throws no_credentials when claudeAiOauth field is missing", async () => {
    fs.writeFileSync(credentialsPath, JSON.stringify({ other: "data" }));
    await expect(fetchClaudeRateLimits()).rejects.toMatchObject({
      name: "QuotaFetchError",
      reason: "no_credentials"
    });
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
        status: 200,
        statusText: "OK",
        json: async () => mockResponse
      })
    );

    const result = await fetchClaudeRateLimits();
    expect(result.five_hour?.utilization).toBe(40);
    expect(result.seven_day?.utilization).toBe(20);
    expect(result.seven_day_sonnet?.utilization).toBe(15);
    expect(result.extra_usage?.is_enabled).toBe(false);
  });

  it("throws auth_failed when the API response is 401/403", async () => {
    const expiresAt = Date.now() + 3600_000;
    fs.writeFileSync(
      credentialsPath,
      JSON.stringify({
        claudeAiOauth: { accessToken: "sk-ant-oat01-valid", expiresAt }
      })
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({})
      })
    );

    await expect(fetchClaudeRateLimits()).rejects.toMatchObject({
      name: "QuotaFetchError",
      reason: "auth_failed"
    });
  });
});

