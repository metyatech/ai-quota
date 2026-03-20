import { describe, expect, it } from "vitest";
import type { AllRateLimits } from "../src/types.js";
import { CliUsageError, parseCliRunOptions, shouldExitNonZero } from "../src/cli-core.js";
import { SUPPORTED_AGENTS } from "../src/index.js";

function buildAllRateLimits(overrides?: Partial<AllRateLimits>): AllRateLimits {
  return {
    summary: { status: "healthy", message: "ok" },
    claude: { status: "ok", data: null, reason: null, error: null, display: "ok" },
    gemini: { status: "ok", data: null, reason: null, error: null, display: "ok" },
    copilot: { status: "ok", data: null, reason: null, error: null, display: "ok" },
    codex: { status: "ok", data: null, reason: null, error: null, display: "ok" },
    ...overrides
  };
}

describe("parseCliRunOptions", () => {
  it("parses known flags and agents", () => {
    const parsed = parseCliRunOptions(
      ["--json", "--strict", "--verbose", "claude", "codex"],
      SUPPORTED_AGENTS
    );

    expect(parsed.jsonMode).toBe(true);
    expect(parsed.strict).toBe(true);
    expect(parsed.verbose).toBe(true);
    expect(parsed.requestedAgents).toEqual(["claude", "codex"]);
  });

  it("throws on unknown flag", () => {
    expect(() => parseCliRunOptions(["--nope"], SUPPORTED_AGENTS)).toThrow(CliUsageError);
  });

  it("throws on unknown agent", () => {
    expect(() => parseCliRunOptions(["not-an-agent"], SUPPORTED_AGENTS)).toThrow(CliUsageError);
  });
});

describe("shouldExitNonZero", () => {
  it("returns false by default even when one provider errors", () => {
    const result = buildAllRateLimits({
      claude: {
        status: "error",
        data: null,
        reason: "auth_failed",
        error: "login required",
        display: "error (auth_failed)"
      }
    });

    expect(shouldExitNonZero(result, false)).toBe(false);
  });

  it("returns true in strict mode when any provider errors", () => {
    const result = buildAllRateLimits({
      claude: {
        status: "error",
        data: null,
        reason: "auth_failed",
        error: "login required",
        display: "error (auth_failed)"
      }
    });

    expect(shouldExitNonZero(result, true)).toBe(true);
  });

  it("returns false in strict mode when there are no provider errors", () => {
    const result = buildAllRateLimits({
      claude: {
        status: "no-data",
        data: null,
        reason: "no_credentials",
        error: null,
        display: "no data (no_credentials)"
      }
    });

    expect(shouldExitNonZero(result, true)).toBe(false);
  });
});
