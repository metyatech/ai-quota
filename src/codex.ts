import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { RateLimitSnapshot, RateLimitWindow } from "./types.js";
import { QuotaFetchError } from "./errors.js";

export type { RateLimitSnapshot, RateLimitWindow } from "./types.js";

export type UsageWindowKey = "fiveHour" | "weekly";

export type UsageWindow = {
  key: UsageWindowKey;
  label: string;
  percentLeft: number;
  resetAt: Date;
  resetText: string;
};

export type CodexStatus = {
  windows: UsageWindow[];
  credits: number | null;
  raw: string;
};

export type FetchCodexRateLimitsOptions = {
  codexHome?: string;
  timeoutSeconds?: number;
  timingSink?: (phase: string, durationMs: number) => void;
};

function resolveCodexHome(codexHome?: string): string {
  return codexHome ?? join(homedir(), ".codex");
}

function resolveWindowMinutes(window: RateLimitWindow): number | null {
  const candidates = [window.windowDurationMins, window.windowMinutes, window.window_minutes];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function resolveResetsAt(window: RateLimitWindow): number | null {
  const candidates = [window.resetsAt, window.resets_at];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function normalizeRateLimitWindow(
  window: RateLimitWindow,
  now: Date
): { usedPercent: number; windowMinutes: number | null; resetAt: Date | null } | null {
  const usedPercent =
    typeof window.usedPercent === "number"
      ? window.usedPercent
      : typeof window.used_percent === "number"
        ? window.used_percent
        : Number.NaN;

  if (!Number.isFinite(usedPercent)) return null;

  const windowMinutes = resolveWindowMinutes(window);
  const resetsAt = resolveResetsAt(window);
  let resetAt: Date | null = null;
  if (typeof resetsAt === "number" && Number.isFinite(resetsAt)) {
    resetAt = new Date(resetsAt * 1000);
  } else if (windowMinutes !== null) {
    resetAt = new Date(now.getTime() + windowMinutes * 60000);
  }

  return { usedPercent, windowMinutes, resetAt };
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 100);
}

/**
 * Converts a raw `RateLimitSnapshot` into a structured `CodexStatus` with labelled usage windows.
 */
export function rateLimitSnapshotToStatus(
  snapshot: RateLimitSnapshot,
  now: Date = new Date()
): CodexStatus | null {
  type NormalizedCandidate = {
    source: "primary" | "secondary";
    data: { usedPercent: number; windowMinutes: number | null; resetAt: Date | null };
  };

  const candidates = [
    snapshot.primary
      ? { source: "primary" as const, data: normalizeRateLimitWindow(snapshot.primary, now) }
      : null,
    snapshot.secondary
      ? { source: "secondary" as const, data: normalizeRateLimitWindow(snapshot.secondary, now) }
      : null
  ].filter((item): item is NormalizedCandidate => Boolean(item?.data));

  if (candidates.length === 0) return null;

  let fiveHourCandidate: NormalizedCandidate | null = null;
  let weeklyCandidate: NormalizedCandidate | null = null;

  if (candidates.length === 2) {
    const [first, second] = candidates as [NormalizedCandidate, NormalizedCandidate];
    if (first.data.windowMinutes !== null && second.data.windowMinutes !== null) {
      if (first.data.windowMinutes <= second.data.windowMinutes) {
        fiveHourCandidate = first;
        weeklyCandidate = second;
      } else {
        fiveHourCandidate = second;
        weeklyCandidate = first;
      }
    } else {
      fiveHourCandidate = first.source === "primary" ? first : second;
      weeklyCandidate = first.source === "primary" ? second : first;
    }
  } else {
    const lone = candidates[0] as NormalizedCandidate;
    if (lone.data.windowMinutes !== null && lone.data.windowMinutes >= 24 * 60) {
      weeklyCandidate = lone;
    } else {
      fiveHourCandidate = lone;
    }
  }

  const windows: UsageWindow[] = [];

  if (fiveHourCandidate?.data.resetAt) {
    windows.push({
      key: "fiveHour",
      label: "5h",
      percentLeft: clampPercent(100 - fiveHourCandidate.data.usedPercent),
      resetAt: fiveHourCandidate.data.resetAt,
      resetText: fiveHourCandidate.data.resetAt.toISOString()
    });
  }

  if (weeklyCandidate?.data.resetAt) {
    windows.push({
      key: "weekly",
      label: "7d",
      percentLeft: clampPercent(100 - weeklyCandidate.data.usedPercent),
      resetAt: weeklyCandidate.data.resetAt,
      resetText: weeklyCandidate.data.resetAt.toISOString()
    });
  }

  return { windows, credits: typeof snapshot.credits === "number" ? snapshot.credits : null, raw: "" };
}

type AuthJson = {
  tokens?: {
    access_token?: string;
    account_id?: string;
  };
  account_id?: string;
};

async function readAuthJson(authPath: string): Promise<AuthJson> {
  let raw: string;
  try {
    raw = await readFile(authPath, "utf8");
  } catch (e: unknown) {
    const code = (e as { code?: string } | null)?.code;
    if (code === "ENOENT") {
      throw new QuotaFetchError("no_credentials", `Codex auth.json not found at ${authPath}`, {
        cause: e
      });
    }
    throw new QuotaFetchError("api_error", `Failed to read Codex auth.json at ${authPath}`, { cause: e });
  }

  try {
    return JSON.parse(raw) as AuthJson;
  } catch (e) {
    throw new QuotaFetchError("parse_error", `Failed to parse Codex auth.json at ${authPath}`, {
      cause: e
    });
  }
}

function reasonFromHttpStatus(status: number): "auth_failed" | "endpoint_changed" | "api_error" {
  if (status === 401 || status === 403) return "auth_failed";
  if (status === 404 || status === 410) return "endpoint_changed";
  return "api_error";
}

async function fetchCodexRateLimitsFromApi(
  codexHome: string,
  timeoutMs: number,
  timingSink?: (phase: string, durationMs: number) => void
): Promise<RateLimitSnapshot> {
  const authPath = join(codexHome, "auth.json");
  const auth = await readAuthJson(authPath);

  const accessToken = auth?.tokens?.access_token;
  if (!accessToken) {
    throw new QuotaFetchError("no_credentials", `Codex access_token missing in ${authPath}`);
  }

  const accountId = auth?.tokens?.account_id ?? auth?.account_id;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json"
  };
  if (accountId) {
    headers["chatgpt-account-id"] = accountId;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const apiStart = Date.now();
  let response: Response;
  let bodyText = "";
  try {
    response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
      method: "GET",
      headers,
      signal: controller.signal
    });
    bodyText = await response.text();
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new QuotaFetchError("timeout", "Codex usage request timed out.", { cause: e });
    }
    throw new QuotaFetchError("network_error", "Codex usage request failed.", { cause: e });
  } finally {
    clearTimeout(timer);
    if (timingSink) {
      timingSink("api", Date.now() - apiStart);
    }
  }

  if (!response.ok) {
    const reason = reasonFromHttpStatus(response.status);
    throw new QuotaFetchError(
      reason,
      `Codex usage request failed (${response.status} ${response.statusText}).`,
      { httpStatus: response.status }
    );
  }

  let data: unknown = null;
  try {
    data = bodyText.trim() ? JSON.parse(bodyText) : null;
  } catch (e) {
    throw new QuotaFetchError("parse_error", "Codex usage response was not valid JSON.", { cause: e });
  }

  if (!data || typeof data !== "object") {
    throw new QuotaFetchError("parse_error", "Codex usage response missing JSON object.");
  }

  const record = data as Record<string, unknown>;
  const rateLimits = record["rate_limits"];
  if (!rateLimits || typeof rateLimits !== "object") {
    throw new QuotaFetchError("parse_error", "Codex usage response missing rate_limits.");
  }

  const now = new Date();
  const nowSecs = Math.floor(now.getTime() / 1000);
  const rl = rateLimits as Record<string, unknown>;

  const convertApiWindow = (w: unknown): RateLimitWindow | null => {
    if (typeof w !== "object" || w === null) return null;
    const ww = w as Record<string, unknown>;
    const usedPercent = ww["used_percent"];
    if (typeof usedPercent !== "number") return null;
    const limitWindowSeconds = ww["limit_window_seconds"];
    const resetAfterSeconds = ww["reset_after_seconds"];
    return {
      used_percent: usedPercent,
      windowDurationMins: typeof limitWindowSeconds === "number" ? limitWindowSeconds / 60 : null,
      resetsAt: typeof resetAfterSeconds === "number" ? nowSecs + resetAfterSeconds : null
    };
  };

  const primary = convertApiWindow(rl["primary"]);
  const secondary = convertApiWindow(rl["secondary"]);
  if (!primary && !secondary) {
    throw new QuotaFetchError("parse_error", "Codex usage response missing primary/secondary windows.");
  }

  return { primary, secondary };
}

/**
 * Fetches Codex (ChatGPT) rate limit data from the remote ChatGPT backend API.
 *
 * Reads credentials from `~/.codex/auth.json` and calls the `/backend-api/wham/usage` endpoint.
 */
export async function fetchCodexRateLimits(
  options?: FetchCodexRateLimitsOptions
): Promise<RateLimitSnapshot> {
  const codexHome = resolveCodexHome(options?.codexHome);
  const timeoutSeconds = options?.timeoutSeconds ?? 20;
  return fetchCodexRateLimitsFromApi(codexHome, timeoutSeconds * 1000, options?.timingSink);
}

