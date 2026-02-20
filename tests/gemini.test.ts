import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fetchGeminiRateLimits } from "../src/gemini.js";

describe("fetchGeminiRateLimits", () => {
  let tmpDir: string;
  let credsPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-quota-gemini-"));
    vi.spyOn(os, "homedir").mockReturnValue(tmpDir);
    const geminiDir = path.join(tmpDir, ".gemini");
    fs.mkdirSync(geminiDir, { recursive: true });
    credsPath = path.join(geminiDir, "oauth_creds.json");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws no_credentials when credentials file does not exist", async () => {
    await expect(fetchGeminiRateLimits(1000)).rejects.toMatchObject({
      name: "QuotaFetchError",
      reason: "no_credentials"
    });
  });

  it("throws token_expired when access token is expired and no refresh token", async () => {
    fs.writeFileSync(
      credsPath,
      JSON.stringify({
        access_token: "",
        expiry_date: Date.now() - 1000
      })
    );
    await expect(fetchGeminiRateLimits(1000)).rejects.toMatchObject({
      name: "QuotaFetchError",
      reason: "token_expired"
    });
  });

  it("fetches and parses Gemini quota correctly", async () => {
    const futureExpiry = Date.now() + 3600_000;
    fs.writeFileSync(
      credsPath,
      JSON.stringify({
        access_token: "ya29.valid-token",
        expiry_date: futureExpiry
      })
    );

    const loadCodeAssistResponse = {
      cloudaicompanionProject: "projects/test-project"
    };
    const retrieveUserQuotaResponse = {
      buckets: [
        {
          modelId: "gemini-3-pro-preview",
          remainingFraction: 0.7,
          resetTime: "2026-02-08T00:00:00Z"
        },
        {
          modelId: "gemini-3-flash-preview",
          remainingFraction: 0.9,
          resetTime: "2026-02-08T00:00:00Z"
        }
      ]
    };

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify(loadCodeAssistResponse)
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => JSON.stringify(retrieveUserQuotaResponse)
        })
    );

    const result = await fetchGeminiRateLimits(1000);
    expect(result["gemini-3-pro-preview"]).toBeDefined();
    expect(result["gemini-3-flash-preview"]).toBeDefined();
    expect(result["gemini-3-pro-preview"]?.usage).toBeCloseTo(30, 5);
    expect(result["gemini-3-flash-preview"]?.usage).toBeCloseTo(10, 5);
  });

  it("throws auth_failed when loadCodeAssist fails with 403", async () => {
    const futureExpiry = Date.now() + 3600_000;
    fs.writeFileSync(credsPath, JSON.stringify({ access_token: "ya29.valid-token", expiry_date: futureExpiry }));

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: async () => "Forbidden"
      })
    );

    await expect(fetchGeminiRateLimits(1000)).rejects.toMatchObject({
      name: "QuotaFetchError",
      reason: "auth_failed"
    });
  });
});

