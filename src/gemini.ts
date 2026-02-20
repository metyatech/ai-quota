import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { GeminiUsage } from "./types.js";
import { QuotaFetchError } from "./errors.js";

export type { GeminiUsage, GeminiModelUsage } from "./types.js";

const ENV_GEMINI_OAUTH_CLIENT_ID = "AGENT_RUNNER_GEMINI_OAUTH_CLIENT_ID";
const ENV_GEMINI_OAUTH_CLIENT_SECRET = "AGENT_RUNNER_GEMINI_OAUTH_CLIENT_SECRET";

type RefreshAccessTokenResult = {
  accessToken: string;
  expiryDate?: number;
};

type GeminiOauthClientInfo = {
  clientId?: string;
  clientSecret?: string;
  source?: string;
};

let cachedGeminiOauthClientInfo: GeminiOauthClientInfo | null = null;

function getClientIdFromIdToken(idToken: unknown): string | undefined {
  if (typeof idToken !== "string") return undefined;
  const parts = idToken.split(".");
  if (parts.length !== 3) return undefined;

  try {
    const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    if (typeof payload?.aud === "string" && payload.aud.length > 0) return payload.aud;
    if (typeof payload?.azp === "string" && payload.azp.length > 0) return payload.azp;
    return undefined;
  } catch {
    return undefined;
  }
}

function readGeminiOauthClientInfoFromEnv(): GeminiOauthClientInfo | null {
  const clientId = process.env[ENV_GEMINI_OAUTH_CLIENT_ID];
  const clientSecret = process.env[ENV_GEMINI_OAUTH_CLIENT_SECRET];
  if (!clientId && !clientSecret) return null;

  return {
    clientId: typeof clientId === "string" && clientId.length > 0 ? clientId : undefined,
    clientSecret: typeof clientSecret === "string" && clientSecret.length > 0 ? clientSecret : undefined,
    source: "env"
  };
}

function extractOauthConstantsFromJs(content: string): GeminiOauthClientInfo | null {
  const clientIdMatch = content.match(/const\s+OAUTH_CLIENT_ID\s*=\s*['"]([^'"]+)['"]/);
  const clientSecretMatch = content.match(/const\s+OAUTH_CLIENT_SECRET\s*=\s*['"]([^'"]+)['"]/);
  const clientId = clientIdMatch?.[1];
  const clientSecret = clientSecretMatch?.[1];

  if (!clientId && !clientSecret) return null;

  return {
    clientId,
    clientSecret,
    source: "gemini-cli"
  };
}

function tryReadGeminiCliOauthClientInfoFromWellKnownPaths(): GeminiOauthClientInfo | null {
  const candidates: string[] = [];

  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) {
      const npmGlobal = path.join(appData, "npm", "node_modules");
      candidates.push(
        path.join(
          npmGlobal,
          "@google",
          "gemini-cli",
          "node_modules",
          "@google",
          "gemini-cli-core",
          "dist",
          "src",
          "code_assist",
          "oauth2.js"
        ),
        path.join(npmGlobal, "@google", "gemini-cli-core", "dist", "src", "code_assist", "oauth2.js")
      );
    }
  }

  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, "utf8");
      const extracted = extractOauthConstantsFromJs(content);
      if (extracted) return extracted;
    } catch {
      // ignore and continue
    }
  }

  return null;
}

function getGeminiOauthClientInfo(): GeminiOauthClientInfo | null {
  if (cachedGeminiOauthClientInfo) return cachedGeminiOauthClientInfo;
  cachedGeminiOauthClientInfo =
    readGeminiOauthClientInfoFromEnv() ?? tryReadGeminiCliOauthClientInfoFromWellKnownPaths();
  return cachedGeminiOauthClientInfo;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new QuotaFetchError("timeout", `Gemini request timed out: ${url}`, { cause: e });
    }
    throw new QuotaFetchError("network_error", `Gemini request failed: ${url}`, { cause: e });
  } finally {
    clearTimeout(timer);
  }
}

async function refreshAccessToken(options: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  timeoutMs: number;
}): Promise<RefreshAccessTokenResult> {
  const params = new URLSearchParams();
  params.set("client_id", options.clientId);
  params.set("client_secret", options.clientSecret);
  params.set("refresh_token", options.refreshToken);
  params.set("grant_type", "refresh_token");

  const res = await fetchWithTimeout(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString()
    },
    options.timeoutMs
  );

  const text = await res.text();
  if (!res.ok) {
    const reason = res.status === 400 || res.status === 401 || res.status === 403 ? "auth_failed" : "api_error";
    throw new QuotaFetchError(reason, `Failed to refresh Google access token (${res.status}).`, {
      httpStatus: res.status
    });
  }

  let data: Record<string, unknown>;
  try {
    data = (text.trim() ? JSON.parse(text) : {}) as Record<string, unknown>;
  } catch (e) {
    throw new QuotaFetchError("parse_error", "Google token refresh response was not valid JSON.", { cause: e });
  }

  if (typeof data?.access_token !== "string" || (data.access_token as string).length === 0) {
    throw new QuotaFetchError("parse_error", "Google token refresh response missing access_token.");
  }

  const expiryDate =
    typeof data?.expires_in === "number"
      ? Date.now() + Math.max(0, data.expires_in as number) * 1000
      : undefined;

  return { accessToken: data.access_token as string, expiryDate };
}

async function getCredentials(timeoutMs: number): Promise<{ accessToken: string }> {
  const credsPath = path.join(os.homedir(), ".gemini", "oauth_creds.json");
  if (!fs.existsSync(credsPath)) {
    throw new QuotaFetchError("no_credentials", `Gemini OAuth credentials not found at ${credsPath}`);
  }

  let creds: Record<string, unknown>;
  try {
    creds = JSON.parse(fs.readFileSync(credsPath, "utf8")) as Record<string, unknown>;
  } catch (e) {
    throw new QuotaFetchError("parse_error", `Failed to parse Gemini OAuth credentials at ${credsPath}`, {
      cause: e
    });
  }

  const now = Date.now();
  let accessToken = creds.access_token;

  const expired =
    typeof creds.expiry_date === "number" && Number.isFinite(creds.expiry_date)
      ? (creds.expiry_date as number) < now + 300000
      : false;

  if (typeof accessToken !== "string" || accessToken.length === 0 || expired) {
    if (typeof creds.refresh_token === "string" && creds.refresh_token.length > 0) {
      const discovered = getGeminiOauthClientInfo();
      const clientId =
        getClientIdFromIdToken(creds.id_token) ??
        discovered?.clientId ??
        (typeof creds.client_id === "string" && creds.client_id.length > 0 ? creds.client_id : undefined);
      const clientSecret =
        discovered?.clientSecret ??
        (typeof creds.client_secret === "string" && creds.client_secret.length > 0
          ? creds.client_secret
          : undefined);

      if (!clientId) {
        throw new QuotaFetchError(
          "no_credentials",
          `Gemini OAuth refresh requires a client ID; set ${ENV_GEMINI_OAUTH_CLIENT_ID} or install Gemini CLI.`
        );
      }
      if (!clientSecret) {
        throw new QuotaFetchError(
          "no_credentials",
          `Gemini OAuth refresh requires a client secret; set ${ENV_GEMINI_OAUTH_CLIENT_SECRET} or install Gemini CLI.`
        );
      }

      const refreshed = await refreshAccessToken({
        refreshToken: creds.refresh_token as string,
        clientId,
        clientSecret,
        timeoutMs
      });
      accessToken = refreshed.accessToken;

      try {
        creds.access_token = accessToken;
        if (typeof refreshed.expiryDate === "number") {
          creds.expiry_date = refreshed.expiryDate;
        }
        fs.writeFileSync(credsPath, JSON.stringify(creds, null, 2), "utf8");
      } catch {
        // Best-effort: keep the refreshed token in memory even if persisting fails.
      }
    } else {
      throw new QuotaFetchError("token_expired", "Gemini access token expired and no refresh token available.");
    }
  }

  return { accessToken: accessToken as string };
}

function reasonFromHttpStatus(status: number): "auth_failed" | "endpoint_changed" | "api_error" {
  if (status === 401 || status === 403) return "auth_failed";
  if (status === 404 || status === 410) return "endpoint_changed";
  return "api_error";
}

/**
 * Fetches Gemini quota usage from the Cloud Code Assist API.
 *
 * @param timeoutMs - Per-request timeout in milliseconds (default: 10000ms)
 */
export async function fetchGeminiRateLimits(timeoutMs: number = 10000): Promise<GeminiUsage> {
  const { accessToken } = await getCredentials(timeoutMs);

  const loadRes = await fetchWithTimeout(
    "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "User-Agent": "ai-quota"
      },
      body: JSON.stringify({
        metadata: {
          ideType: "GEMINI_CLI",
          platform: process.platform === "win32" ? "WINDOWS_AMD64" : "LINUX_AMD64"
        }
      })
    },
    timeoutMs
  );

  const loadText = await loadRes.text();
  if (!loadRes.ok) {
    throw new QuotaFetchError(
      reasonFromHttpStatus(loadRes.status),
      `loadCodeAssist failed (${loadRes.status} ${loadRes.statusText}).`,
      { httpStatus: loadRes.status }
    );
  }

  let loadData: Record<string, unknown>;
  try {
    loadData = (loadText.trim() ? JSON.parse(loadText) : {}) as Record<string, unknown>;
  } catch (e) {
    throw new QuotaFetchError("parse_error", "loadCodeAssist returned invalid JSON.", { cause: e });
  }

  const projectId = loadData.cloudaicompanionProject;
  if (!projectId) {
    throw new QuotaFetchError("parse_error", "No cloudaicompanionProject found in loadCodeAssist response.");
  }

  const quotaRes = await fetchWithTimeout(
    "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "User-Agent": "ai-quota"
      },
      body: JSON.stringify({ project: projectId })
    },
    timeoutMs
  );

  const quotaText = await quotaRes.text();
  if (!quotaRes.ok) {
    throw new QuotaFetchError(
      reasonFromHttpStatus(quotaRes.status),
      `retrieveUserQuota failed (${quotaRes.status} ${quotaRes.statusText}).`,
      { httpStatus: quotaRes.status }
    );
  }

  let quotaData: Record<string, unknown>;
  try {
    quotaData = (quotaText.trim() ? JSON.parse(quotaText) : {}) as Record<string, unknown>;
  } catch (e) {
    throw new QuotaFetchError("parse_error", "retrieveUserQuota returned invalid JSON.", { cause: e });
  }

  const usage: GeminiUsage = {};
  if (Array.isArray(quotaData.buckets)) {
    for (const bucket of quotaData.buckets as Record<string, unknown>[]) {
      const modelId = typeof bucket.modelId === "string" ? bucket.modelId : null;
      if (!modelId) continue;

      const remainingFraction =
        typeof bucket.remainingFraction === "number" && Number.isFinite(bucket.remainingFraction)
          ? Math.min(Math.max(bucket.remainingFraction, 0), 1)
          : 1.0;
      const limit = 100;
      const usedRaw = (1.0 - remainingFraction) * 100;
      const used = Math.round(usedRaw * 1_000_000) / 1_000_000;

      const resetAt = bucket.resetTime ? new Date(bucket.resetTime as string) : new Date(Date.now() + 3600000);
      if (Number.isNaN(resetAt.getTime())) {
        throw new QuotaFetchError("parse_error", "Gemini quota bucket resetTime was invalid.");
      }

      usage[modelId] = { limit, usage: used, resetAt };
    }
  }

  return usage;
}

