import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fetchClaudeRateLimits } from "../src/claude.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function getHeader(headers: unknown, name: string): string | undefined {
  if (!headers) return undefined;
  const target = name.toLowerCase();
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (Array.isArray(headers)) {
    const entry = headers.find((pair) => {
      if (!Array.isArray(pair) || pair.length < 2) return false;
      const key = pair[0];
      return typeof key === "string" && key.toLowerCase() === target;
    });
    if (!entry || !Array.isArray(entry) || entry.length < 2) return undefined;
    const value = entry[1];
    return typeof value === "string" ? value : undefined;
  }
  if (typeof headers !== "object") return undefined;
  const record = headers as Record<string, unknown>;
  const entry = Object.entries(record).find(([key]) => key.toLowerCase() === target);
  const value = entry?.[1];
  return typeof value === "string" ? value : undefined;
}

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

  it("refreshes token and retries usage when the first usage call returns 429", async () => {
    const expiresAt = Date.now() + 3600_000;
    fs.writeFileSync(
      credentialsPath,
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "sk-ant-oat01-stale",
          refreshToken: "sk-ant-ort01-refresh",
          expiresAt
        }
      })
    );

    const mockResponse = {
      five_hour: { utilization: 12, resets_at: "2026-02-02T15:00:00Z" },
      seven_day: { utilization: 7, resets_at: "2026-02-08T00:00:00Z" },
      seven_day_sonnet: { utilization: 5, resets_at: "2026-02-08T00:00:00Z" },
      extra_usage: { is_enabled: true, monthly_limit: 2000, used_credits: 0, utilization: 0 }
    };

    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/oauth/usage")) {
        const authorization = getHeader(init?.headers, "authorization");
        if (authorization === "Bearer sk-ant-oat01-stale") {
          return {
            ok: false,
            status: 429,
            statusText: "Too Many Requests",
            json: async () => ({ error: { message: "rate limited" } })
          } as Response;
        }
        if (authorization === "Bearer sk-ant-oat01-fresh") {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            json: async () => mockResponse
          } as Response;
        }
      }

      if (url.endsWith("/v1/oauth/token")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({
            access_token: "sk-ant-oat01-fresh",
            refresh_token: "sk-ant-ort01-fresh",
            expires_in: 28_800
          })
        } as Response;
      }

      return {
        ok: false,
        status: 500,
        statusText: "Unexpected",
        json: async () => ({})
      } as Response;
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchClaudeRateLimits();
    expect(result.five_hour?.utilization).toBe(12);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const updated = JSON.parse(fs.readFileSync(credentialsPath, "utf8")) as {
      claudeAiOauth?: { accessToken?: string; refreshToken?: string };
    };
    expect(updated.claudeAiOauth?.accessToken).toBe("sk-ant-oat01-fresh");
    expect(updated.claudeAiOauth?.refreshToken).toBe("sk-ant-ort01-fresh");
  });

  it("refreshes token before usage call when token is near expiration", async () => {
    const expiresAt = Date.now() + 60_000; // within 5-minute buffer
    fs.writeFileSync(
      credentialsPath,
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "sk-ant-oat01-near-expire",
          refreshToken: "sk-ant-ort01-refresh",
          expiresAt
        }
      })
    );

    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/oauth/token")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({
            access_token: "sk-ant-oat01-fresh",
            refresh_token: "sk-ant-ort01-rotated",
            expires_in: 28_800
          })
        } as Response;
      }
      if (url.endsWith("/api/oauth/usage")) {
        const authorization = getHeader(init?.headers, "authorization");
        expect(authorization).toBe("Bearer sk-ant-oat01-fresh");
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({
            five_hour: { utilization: 4, resets_at: "2026-02-02T15:00:00Z" },
            seven_day: null,
            seven_day_sonnet: null,
            extra_usage: null
          })
        } as Response;
      }
      return {
        ok: false,
        status: 500,
        statusText: "Unexpected",
        json: async () => ({})
      } as Response;
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchClaudeRateLimits();
    expect(result.five_hour?.utilization).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws auth_failed when refresh token exchange fails", async () => {
    const expiresAt = Date.now() + 60_000; // within 5-minute buffer
    fs.writeFileSync(
      credentialsPath,
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "sk-ant-oat01-near-expire",
          refreshToken: "sk-ant-ort01-invalid",
          expiresAt
        }
      })
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: async () => ({ error: "invalid_grant" })
      })
    );

    await expect(fetchClaudeRateLimits()).rejects.toMatchObject({
      name: "QuotaFetchError",
      reason: "auth_failed"
    });
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
