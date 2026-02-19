import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import type { CopilotUsage } from "./types.js";

export type { CopilotUsage } from "./types.js";

/**
 * Resolves a GitHub Copilot token from environment variables,
 * local GitHub CLI configuration files, or the 'gh' CLI command.
 */
export function getCopilotToken(verbose: boolean = false): string | null {
  if (process.env.GITHUB_TOKEN) {
    if (verbose) process.stderr.write("[verbose] copilot: using token from GITHUB_TOKEN env var\n");
    return process.env.GITHUB_TOKEN;
  }
  const candidates = [
    path.join(os.homedir(), ".config", "gh", "hosts.yml"),
    path.join(os.homedir(), "AppData", "Roaming", "GitHub CLI", "hosts.yml")
  ];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      if (verbose) process.stderr.write(`[verbose] copilot: checking ${p}\n`);
      const content = fs.readFileSync(p, "utf8");
      // Simple line-by-line search for oauth_token under github.com
      const match = content.match(/oauth_token:\s*(\S+)/);
      if (match?.[1]) {
        if (verbose) process.stderr.write(`[verbose] copilot: found token in ${p}\n`);
        return match[1];
      }
    } catch {
      // ignore
    }
  }

  // Final fallback: try 'gh auth token'
  try {
    if (verbose)
      process.stderr.write("[verbose] copilot: trying 'gh auth token --hostname github.com'\n");
    const token = execSync("gh auth token --hostname github.com", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (token) {
      if (verbose) process.stderr.write("[verbose] copilot: found token via gh CLI\n");
      return token;
    }
  } catch {
    // ignore
  }

  return null;
}

const DEFAULT_API_BASE_URL = "https://api.github.com";
const DEFAULT_API_VERSION = "2025-05-01";

export type FetchCopilotRateLimitsOptions = {
  token: string;
  timeoutSeconds?: number;
  apiBaseUrl?: string;
  apiVersion?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizePercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function normalizeApiBaseUrl(value: string | undefined): string {
  const base = value?.trim() || DEFAULT_API_BASE_URL;
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

/**
 * Parses a GitHub Copilot user info response body into a CopilotUsage snapshot.
 *
 * Returns null when the response does not contain the expected fields.
 */
export function parseCopilotUserInfo(data: unknown, _now: Date = new Date()): CopilotUsage | null {
  if (!isRecord(data)) return null;

  const quotaSnapshots = data.quota_snapshots;
  if (!isRecord(quotaSnapshots)) return null;

  const premium = quotaSnapshots.premium_interactions;
  if (!isRecord(premium)) return null;

  const entitlement = toNumber(premium.entitlement);
  const percentRemaining = toNumber(premium.percent_remaining);
  const resetText = typeof data.quota_reset_date === "string" ? data.quota_reset_date : null;

  if (entitlement === null || percentRemaining === null || !resetText) return null;

  const resetAt = new Date(resetText);
  if (Number.isNaN(resetAt.getTime())) return null;

  const overageUsed = toNumber(premium.overage_count) ?? 0;
  const overageEnabled = premium.overage_permitted === true;

  return {
    percentRemaining: normalizePercent(percentRemaining),
    resetAt,
    entitlement,
    overageUsed,
    overageEnabled,
    source: "user",
    raw: data
  };
}

/**
 * Parses a Copilot quota snapshot from an HTTP response header value.
 *
 * The header is formatted as URL search params, e.g.:
 * `ent=3000&rem=64&rst=2026-02-15T00:00:00Z&ov=0&ovPerm=false`
 */
export function parseCopilotQuotaHeader(
  headerValue: string,
  now: Date = new Date()
): CopilotUsage | null {
  const trimmed = headerValue.trim();
  if (!trimmed) return null;

  const params = new URLSearchParams(trimmed);
  const entitlement = toNumber(params.get("ent"));
  const percentRemaining = toNumber(params.get("rem"));

  if (entitlement === null || percentRemaining === null) return null;

  const resetText = params.get("rst");
  const resetAt = resetText ? new Date(resetText) : new Date(now.getTime());
  if (resetText && Number.isNaN(resetAt.getTime())) return null;
  if (!resetText) {
    resetAt.setMonth(resetAt.getMonth() + 1);
  }

  const overageUsed = toNumber(params.get("ov")) ?? 0;
  const overageEnabled = params.get("ovPerm") === "true";

  return {
    percentRemaining: normalizePercent(percentRemaining),
    resetAt,
    entitlement,
    overageUsed,
    overageEnabled,
    source: "header",
    raw: headerValue
  };
}

/**
 * Fetches Copilot quota usage from the GitHub Copilot internal API.
 *
 * Requires a valid GitHub personal access token with `copilot` scope.
 * Falls back to the `x-quota-snapshot-*` response header when the body
 * does not contain the expected fields.
 */
export async function fetchCopilotRateLimits(
  options: FetchCopilotRateLimitsOptions,
  now: Date = new Date()
): Promise<CopilotUsage | null> {
  const baseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
  const url = `${baseUrl}/copilot_internal/user`;
  const controller = new AbortController();
  const timeoutSeconds = options.timeoutSeconds ?? 20;
  const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  const apiVersion = options.apiVersion?.trim() || DEFAULT_API_VERSION;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `token ${options.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": apiVersion,
        "User-Agent": "ai-quota"
      },
      signal: controller.signal
    });

    const headerValue =
      response.headers.get("x-quota-snapshot-premium_interactions") ||
      response.headers.get("x-quota-snapshot-premium_models");
    const headerUsage = headerValue ? parseCopilotQuotaHeader(headerValue, now) : null;

    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(
        `Copilot user info request failed (${response.status} ${response.statusText}).`
      );
    }

    let parsed: unknown = null;
    if (bodyText.trim()) {
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        parsed = null;
      }
    }

    const usage = parseCopilotUserInfo(parsed, now);
    return usage ?? headerUsage;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Copilot user info request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
