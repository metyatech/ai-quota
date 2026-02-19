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

  it("returns null when credentials file does not exist", async () => {
    const result = await fetchGeminiRateLimits();
    expect(result).toBeNull();
  });

  it("returns null when access token fetch fails", async () => {
    // Write creds with expired token but no refresh_token
    fs.writeFileSync(
      credsPath,
      JSON.stringify({
        access_token: "",
        expiry_date: Date.now() - 1000
        // no refresh_token
      })
    );
    const result = await fetchGeminiRateLimits();
    expect(result).toBeNull();
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
          text: async () => "",
          json: async () => loadCodeAssistResponse
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => "",
          json: async () => retrieveUserQuotaResponse
        })
    );

    const result = await fetchGeminiRateLimits();
    expect(result).not.toBeNull();
    expect(result?.["gemini-3-pro-preview"]).toBeDefined();
    expect(result?.["gemini-3-flash-preview"]).toBeDefined();
    // 1 - 0.7 = 0.3 used; 0.3 * 100 = 30
    expect(result?.["gemini-3-pro-preview"]?.usage).toBeCloseTo(30, 5);
    expect(result?.["gemini-3-flash-preview"]?.usage).toBeCloseTo(10, 5);
  });

  it("returns null when loadCodeAssist fails", async () => {
    const futureExpiry = Date.now() + 3600_000;
    fs.writeFileSync(
      credsPath,
      JSON.stringify({ access_token: "ya29.valid-token", expiry_date: futureExpiry })
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => "Forbidden"
      })
    );

    const result = await fetchGeminiRateLimits();
    expect(result).toBeNull();
  });
});
