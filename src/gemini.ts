import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { GeminiUsage } from "./types.js";

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
    clientSecret:
      typeof clientSecret === "string" && clientSecret.length > 0 ? clientSecret : undefined,
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
        path.join(
          npmGlobal,
          "@google",
          "gemini-cli-core",
          "dist",
          "src",
          "code_assist",
          "oauth2.js"
        )
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

async function refreshAccessToken(options: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<RefreshAccessTokenResult> {
  const params = new URLSearchParams();
  params.set("client_id", options.clientId);
  params.set("client_secret", options.clientSecret);
  params.set("refresh_token", options.refreshToken);
  params.set("grant_type", "refresh_token");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });

  if (!res.ok) {
    throw new Error(`Failed to refresh Google access token: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  if (typeof data?.access_token !== "string" || (data.access_token as string).length === 0) {
    throw new Error("Google token refresh response missing access_token.");
  }

  const expiryDate =
    typeof data?.expires_in === "number"
      ? Date.now() + Math.max(0, data.expires_in as number) * 1000
      : undefined;

  return { accessToken: data.access_token as string, expiryDate };
}

async function getCredentials(): Promise<{ accessToken: string }> {
  const credsPath = path.join(os.homedir(), ".gemini", "oauth_creds.json");
  if (!fs.existsSync(credsPath)) {
    throw new Error(`Gemini OAuth credentials not found at ${credsPath}`);
  }

  const raw = fs.readFileSync(credsPath, "utf8");
  const creds = JSON.parse(raw) as Record<string, unknown>;

  let accessToken = creds.access_token;
  const now = Date.now();
  // Buffer of 5 minutes
  if (!accessToken || (typeof creds.expiry_date === "number" && creds.expiry_date < now + 300000)) {
    if (creds.refresh_token) {
      const discovered = getGeminiOauthClientInfo();
      const clientId =
        getClientIdFromIdToken(creds.id_token) ??
        discovered?.clientId ??
        (typeof creds.client_id === "string" && creds.client_id.length > 0
          ? creds.client_id
          : undefined);
      const clientSecret =
        discovered?.clientSecret ??
        (typeof creds.client_secret === "string" && creds.client_secret.length > 0
          ? creds.client_secret
          : undefined);

      if (!clientId) {
        throw new Error(
          `Gemini OAuth refresh requires a client ID; set ${ENV_GEMINI_OAUTH_CLIENT_ID} or install Gemini CLI.`
        );
      }
      if (!clientSecret) {
        throw new Error(
          `Gemini OAuth refresh requires a client secret; set ${ENV_GEMINI_OAUTH_CLIENT_SECRET} or install Gemini CLI.`
        );
      }

      const refreshed = await refreshAccessToken({
        refreshToken: creds.refresh_token as string,
        clientId,
        clientSecret
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
      throw new Error("Gemini access token expired and no refresh token available.");
    }
  }

  return { accessToken: accessToken as string };
}

/**
 * Fetches Gemini quota usage from the Cloud Code Assist API.
 *
 * Reads OAuth credentials from `~/.gemini/oauth_creds.json` and automatically
 * refreshes the access token when needed. Returns null on any error.
 *
 * The environment variables `AGENT_RUNNER_GEMINI_OAUTH_CLIENT_ID` and
 * `AGENT_RUNNER_GEMINI_OAUTH_CLIENT_SECRET` can override the OAuth client
 * credentials when the Gemini CLI is not installed.
 */
export async function fetchGeminiRateLimits(): Promise<GeminiUsage | null> {
  try {
    const { accessToken } = await getCredentials();

    // 1. Load Code Assist to get the project ID
    const loadRes = await fetch("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist", {
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
    });

    if (!loadRes.ok) {
      throw new Error(`loadCodeAssist failed: ${loadRes.status} ${await loadRes.text()}`);
    }

    const loadData = (await loadRes.json()) as Record<string, unknown>;
    const projectId = loadData.cloudaicompanionProject;

    if (!projectId) {
      throw new Error("No cloudaicompanionProject found in loadCodeAssist response.");
    }

    // 2. Retrieve User Quota
    const quotaRes = await fetch(
      "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": "ai-quota"
        },
        body: JSON.stringify({ project: projectId })
      }
    );

    if (!quotaRes.ok) {
      throw new Error(`retrieveUserQuota failed: ${quotaRes.status} ${await quotaRes.text()}`);
    }

    const quotaData = (await quotaRes.json()) as Record<string, unknown>;
    const usage: GeminiUsage = {};

    if (Array.isArray(quotaData.buckets)) {
      for (const bucket of quotaData.buckets as Record<string, unknown>[]) {
        const modelId = bucket.modelId;
        if (modelId === "gemini-3-pro-preview" || modelId === "gemini-3-flash-preview") {
          // remainingFraction is usually between 0.0 and 1.0.
          // Keep fractional precision so tiny consumption (<0.5%) does not get rounded away.
          const remainingFraction =
            typeof bucket.remainingFraction === "number" &&
            Number.isFinite(bucket.remainingFraction)
              ? Math.min(Math.max(bucket.remainingFraction, 0), 1)
              : 1.0;
          const limit = 100; // percentage scale
          const usedRaw = (1.0 - remainingFraction) * 100;
          const used = Math.round(usedRaw * 1_000_000) / 1_000_000;
          usage[modelId as keyof GeminiUsage] = {
            limit,
            usage: used,
            resetAt: bucket.resetTime
              ? new Date(bucket.resetTime as string)
              : new Date(Date.now() + 3600000)
          };
        }
      }
    }

    return usage;
  } catch (error) {
    console.error("Error fetching Gemini usage:", error);
    return null;
  }
}
