import fs from "node:fs";
import path from "node:path";
import type { ClaudeUsageData } from "./types.js";
import { QuotaFetchError } from "./errors.js";

export type { ClaudeUsageData, ClaudeUsageBucket } from "./types.js";

const CLAUDE_OAUTH_TOKEN_URL =
  process.env.CLAUDE_CODE_OAUTH_TOKEN_URL ?? "https://platform.claude.com/v1/oauth/token";
const CLAUDE_OAUTH_CLIENT_ID =
  process.env.CLAUDE_CODE_OAUTH_CLIENT_ID ?? "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_OAUTH_SCOPES =
  process.env.CLAUDE_CODE_OAUTH_SCOPES ??
  "user:profile user:inference user:sessions:claude_code user:mcp_servers";

type ClaudeCredentials = {
  accessToken: string;
  expiresAt: number;
  refreshToken: string | null;
};

function getClaudeConfigDir(): string {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  return path.join(home, ".claude");
}

function getClaudeCredentialsPath(): string {
  return path.join(getClaudeConfigDir(), ".credentials.json");
}

function readClaudeCredentials(): ClaudeCredentials | null {
  const credsPath = getClaudeCredentialsPath();
  try {
    if (!fs.existsSync(credsPath)) {
      throw new QuotaFetchError("no_credentials", `Claude credentials not found at ${credsPath}`);
    }
    const raw = fs.readFileSync(credsPath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (e) {
      throw new QuotaFetchError(
        "parse_error",
        `Failed to parse Claude credentials at ${credsPath}`,
        {
          cause: e
        }
      );
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
    const refreshToken =
      typeof oauthRecord.refreshToken === "string" && oauthRecord.refreshToken.length > 0
        ? oauthRecord.refreshToken
        : null;
    if (!accessToken || expiresAt === null) return null;
    return { accessToken, expiresAt, refreshToken };
  } catch (e) {
    if (e instanceof QuotaFetchError) throw e;
    throw new QuotaFetchError("api_error", "Failed to read Claude credentials.", { cause: e });
  }
}

function persistClaudeCredentialsUpdate(
  creds: Pick<ClaudeCredentials, "accessToken" | "expiresAt" | "refreshToken">
): void {
  const credsPath = getClaudeCredentialsPath();
  try {
    if (!fs.existsSync(credsPath)) return;
    const raw = fs.readFileSync(credsPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return;
    const record = parsed as Record<string, unknown>;
    if (!record.claudeAiOauth || typeof record.claudeAiOauth !== "object") return;

    const oauthRecord = record.claudeAiOauth as Record<string, unknown>;
    oauthRecord.accessToken = creds.accessToken;
    oauthRecord.expiresAt = creds.expiresAt;
    if (creds.refreshToken) {
      oauthRecord.refreshToken = creds.refreshToken;
    }

    fs.writeFileSync(credsPath, JSON.stringify(record));
  } catch {
    // Refresh succeeded; a local persistence failure should not fail quota fetch.
  }
}

async function requestClaudeUsage(accessToken: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch("https://api.anthropic.com/api/oauth/usage", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
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
}

async function refreshClaudeAccessToken(
  refreshToken: string,
  timeoutMs: number
): Promise<ClaudeCredentials> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(CLAUDE_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLAUDE_OAUTH_CLIENT_ID,
        scope: CLAUDE_OAUTH_SCOPES
      }),
      signal: controller.signal
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new QuotaFetchError("timeout", "Claude OAuth token refresh timed out.", { cause: e });
    }
    throw new QuotaFetchError("network_error", "Claude OAuth token refresh failed.", { cause: e });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const reason = res.status >= 400 && res.status < 500 ? "auth_failed" : "api_error";
    throw new QuotaFetchError(
      reason,
      `Claude OAuth token refresh failed (${res.status} ${res.statusText}).`,
      { httpStatus: res.status }
    );
  }

  let data: unknown;
  try {
    data = (await res.json()) as unknown;
  } catch (e) {
    throw new QuotaFetchError("parse_error", "Claude OAuth token refresh response was invalid.", {
      cause: e
    });
  }

  if (!data || typeof data !== "object") {
    throw new QuotaFetchError("parse_error", "Claude OAuth token refresh response was invalid.");
  }

  const record = data as Record<string, unknown>;
  const accessToken =
    typeof record.access_token === "string" && record.access_token.length > 0
      ? record.access_token
      : null;
  const expiresIn =
    typeof record.expires_in === "number" && Number.isFinite(record.expires_in)
      ? record.expires_in
      : null;
  const nextRefreshToken =
    typeof record.refresh_token === "string" && record.refresh_token.length > 0
      ? record.refresh_token
      : refreshToken;

  if (!accessToken || expiresIn === null) {
    throw new QuotaFetchError(
      "parse_error",
      "Claude OAuth token refresh response missing required fields."
    );
  }

  return {
    accessToken,
    refreshToken: nextRefreshToken,
    expiresAt: Date.now() + expiresIn * 1000
  };
}

/**
 * Fetches Claude usage data from the Anthropic OAuth usage API.
 *
 * This function attempts to read credentials from the Claude desktop application's
 * local storage (`~/.claude/.credentials.json`) and calls the Anthropic usage API.
 * If the access token is stale or rejected, it attempts one OAuth refresh and retries.
 *
 * @param timeoutMs - Request timeout in milliseconds (default: 5000ms)
 * @returns A promise resolving to ClaudeUsageData.
 */
export async function fetchClaudeRateLimits(timeoutMs: number = 5000): Promise<ClaudeUsageData> {
  try {
    const creds = readClaudeCredentials();
    if (!creds) {
      throw new QuotaFetchError("no_credentials", "Claude credentials missing.");
    }

    let accessToken = creds.accessToken;
    let refreshToken = creds.refreshToken;
    let didRefresh = false;

    const refreshAndPersist = async () => {
      if (!refreshToken) {
        throw new QuotaFetchError("token_expired", "Claude access token is expired.");
      }
      const refreshed = await refreshClaudeAccessToken(refreshToken, timeoutMs);
      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken;
      persistClaudeCredentialsUpdate(refreshed);
      didRefresh = true;
    };

    // Check token expiry with 5-minute buffer.
    if (Date.now() + 300_000 >= creds.expiresAt) {
      await refreshAndPersist();
    }

    let res = await requestClaudeUsage(accessToken, timeoutMs);

    // Claude sometimes returns 429 for stale/revoked tokens while normal model calls still work.
    // Retry once with a fresh OAuth token before failing.
    if (
      !res.ok &&
      (res.status === 401 || res.status === 403 || res.status === 429) &&
      !didRefresh &&
      refreshToken
    ) {
      await refreshAndPersist();
      res = await requestClaudeUsage(accessToken, timeoutMs);
    }

    if (!res.ok) {
      const reason = res.status === 401 || res.status === 403 ? "auth_failed" : "api_error";
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
