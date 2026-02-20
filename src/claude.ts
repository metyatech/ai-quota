import fs from "node:fs";
import path from "node:path";
import type { ClaudeUsageData } from "./types.js";
import { QuotaFetchError } from "./errors.js";

export type { ClaudeUsageData, ClaudeUsageBucket } from "./types.js";

function getClaudeConfigDir(): string {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  return path.join(home, ".claude");
}

function readClaudeCredentials(): { accessToken: string; expiresAt: number } | null {
  const credsPath = path.join(getClaudeConfigDir(), ".credentials.json");
  try {
    if (!fs.existsSync(credsPath)) {
      throw new QuotaFetchError("no_credentials", `Claude credentials not found at ${credsPath}`);
    }
    const raw = fs.readFileSync(credsPath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (e) {
      throw new QuotaFetchError("parse_error", `Failed to parse Claude credentials at ${credsPath}`, {
        cause: e
      });
    }
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    const oauth = record.claudeAiOauth;
    if (!oauth || typeof oauth !== "object") return null;
    const oauthRecord = oauth as Record<string, unknown>;
    const accessToken =
      typeof oauthRecord.accessToken === "string" && oauthRecord.accessToken.length > 0
        ? oauthRecord.accessToken
        : null;
    const expiresAt =
      typeof oauthRecord.expiresAt === "number" && Number.isFinite(oauthRecord.expiresAt)
        ? oauthRecord.expiresAt
        : null;
    if (!accessToken || expiresAt === null) return null;
    return { accessToken, expiresAt };
  } catch (e) {
    if (e instanceof QuotaFetchError) throw e;
    throw new QuotaFetchError("api_error", "Failed to read Claude credentials.", { cause: e });
  }
}

/**
 * Fetches Claude usage data from the Anthropic OAuth usage API.
 * 
 * This function attempts to read credentials from the Claude desktop application's
 * local storage (`~/.claude/.credentials.json`) and calls the Anthropic usage API.
 * 
 * @param timeoutMs - Request timeout in milliseconds (default: 5000ms)
 * @returns A promise resolving to ClaudeUsageData or null if credentials are 
 *          missing, expired, or the API request fails.
 */
export async function fetchClaudeRateLimits(
  timeoutMs: number = 5000
): Promise<ClaudeUsageData> {
  try {
    const creds = readClaudeCredentials();
    if (!creds) {
      throw new QuotaFetchError("no_credentials", "Claude credentials missing.");
    }

    // Check token expiry with 5-minute buffer
    if (Date.now() + 300_000 >= creds.expiresAt) {
      throw new QuotaFetchError("token_expired", "Claude access token is expired.");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch("https://api.anthropic.com/api/oauth/usage", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          "Content-Type": "application/json",
          "anthropic-beta": "oauth-2025-04-20"
        },
        signal: controller.signal
      });
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        throw new QuotaFetchError("timeout", "Claude usage request timed out.", { cause: e });
      }
      throw new QuotaFetchError("network_error", "Claude usage request failed.", { cause: e });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const reason =
        res.status === 401 || res.status === 403 ? "auth_failed" : "api_error";
      throw new QuotaFetchError(
        reason,
        `Claude usage request failed (${res.status} ${res.statusText}).`,
        { httpStatus: res.status }
      );
    }

    const data = (await res.json()) as unknown;
    if (!data || typeof data !== "object") {
      throw new QuotaFetchError("parse_error", "Claude usage response was not a JSON object.");
    }
    const record = data as Record<string, unknown>;

    const parseBucket = (val: unknown) => {
      if (!val || typeof val !== "object") return null;
      const b = val as Record<string, unknown>;
      const utilization =
        typeof b.utilization === "number" && Number.isFinite(b.utilization) ? b.utilization : null;
      const resets_at = typeof b.resets_at === "string" ? b.resets_at : null;
      if (utilization === null || !resets_at) return null;
      return { utilization, resets_at };
    };

    const parseExtraUsage = (val: unknown) => {
      if (!val || typeof val !== "object") return null;
      const e = val as Record<string, unknown>;
      const is_enabled = typeof e.is_enabled === "boolean" ? e.is_enabled : false;
      const monthly_limit =
        typeof e.monthly_limit === "number" && Number.isFinite(e.monthly_limit)
          ? e.monthly_limit
          : null;
      const used_credits =
        typeof e.used_credits === "number" && Number.isFinite(e.used_credits) ? e.used_credits : 0;
      const utilization =
        typeof e.utilization === "number" && Number.isFinite(e.utilization) ? e.utilization : 0;
      return { is_enabled, monthly_limit, used_credits, utilization };
    };

    const out: ClaudeUsageData = {
      five_hour: parseBucket(record.five_hour),
      seven_day: parseBucket(record.seven_day),
      seven_day_sonnet: parseBucket(record.seven_day_sonnet),
      extra_usage: parseExtraUsage(record.extra_usage)
    };
    return out;
  } catch (e) {
    if (e instanceof QuotaFetchError) throw e;
    throw new QuotaFetchError("unknown", "Claude usage fetch failed.", { cause: e });
  }
}
