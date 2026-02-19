import fs from "node:fs";
import path from "node:path";
import type { AmazonQUsageSnapshot } from "./types.js";

export type { AmazonQUsageSnapshot } from "./types.js";

/**
 * NOTE: Amazon Q Developer (free tier) does not provide a public API for
 * querying usage or quota programmatically (as of February 2026). There is
 * no official AWS SDK method, REST endpoint, or CLI command that returns
 * the number of agentic requests consumed against the 50-requests/month
 * free-tier limit for Builder ID users.
 *
 * The approach used here — a local JSON counter file — is therefore the
 * best available strategy. Callers must record each Amazon Q invocation
 * with `recordAmazonQUsage` to keep the counter accurate.
 *
 * If AWS publishes an official API in the future, this file should be
 * updated to call it (with the local counter as a fallback).
 */

type AmazonQUsageState = {
  periodKey: string;
  used: number;
  updatedAt: string;
};

function resolveMonthlyPeriodKey(now: Date): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function resolveNextMonthlyResetAt(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

function normalizeUsed(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.floor(value));
}

/**
 * Resolves the default state file path for the Amazon Q usage counter.
 *
 * @param workdirRoot - The root directory of the agent-runner working directory.
 */
export function resolveAmazonQUsageStatePath(workdirRoot: string): string {
  return path.resolve(workdirRoot, "agent-runner", "state", "amazon-q-usage.json");
}

/**
 * Loads the Amazon Q usage state from disk.
 *
 * Returns a fresh zeroed state when the file does not exist or when the
 * stored period key does not match the current month (auto-reset).
 */
export function loadAmazonQUsageState(
  statePath: string,
  now: Date = new Date()
): AmazonQUsageState {
  const currentPeriodKey = resolveMonthlyPeriodKey(now);
  if (!fs.existsSync(statePath)) {
    return {
      periodKey: currentPeriodKey,
      used: 0,
      updatedAt: now.toISOString()
    };
  }

  const raw = fs.readFileSync(statePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid Amazon Q usage state at ${statePath}`);
  }
  const record = parsed as Record<string, unknown>;

  const periodKey = typeof record.periodKey === "string" ? record.periodKey : null;
  const used = normalizeUsed(record.used);
  const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : null;

  if (!periodKey || used === null || !updatedAt) {
    throw new Error(`Invalid Amazon Q usage state at ${statePath}`);
  }

  if (periodKey !== currentPeriodKey) {
    return {
      periodKey: currentPeriodKey,
      used: 0,
      updatedAt: now.toISOString()
    };
  }

  return { periodKey, used, updatedAt };
}

/**
 * Persists Amazon Q usage state to disk.
 */
export function saveAmazonQUsageState(statePath: string, state: AmazonQUsageState): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

/**
 * Increments the local Amazon Q usage counter by `count` (default 1) and
 * persists the updated state.
 *
 * Call this once per Amazon Q invocation to keep the counter accurate.
 */
export function recordAmazonQUsage(
  statePath: string,
  count: number = 1,
  now: Date = new Date()
): AmazonQUsageState {
  const normalizedCount = Math.max(0, Math.floor(count));
  const state = loadAmazonQUsageState(statePath, now);
  const updated: AmazonQUsageState = {
    periodKey: state.periodKey,
    used: state.used + normalizedCount,
    updatedAt: now.toISOString()
  };
  saveAmazonQUsageState(statePath, updated);
  return updated;
}

/**
 * Reads the local counter and returns a quota snapshot.
 *
 * The `monthlyLimit` parameter is the configured monthly request limit
 * (e.g. 50 for the free tier). The snapshot's `percentRemaining` is
 * computed from `(limit - used) / limit * 100`.
 */
export function fetchAmazonQRateLimits(
  statePath: string,
  monthlyLimit: number,
  now: Date = new Date()
): AmazonQUsageSnapshot {
  const state = loadAmazonQUsageState(statePath, now);
  const used = Math.max(0, state.used);
  const percentRemaining =
    monthlyLimit <= 0
      ? 0
      : Math.min(100, Math.max(0, ((monthlyLimit - used) / monthlyLimit) * 100));

  return {
    used,
    limit: monthlyLimit,
    percentRemaining,
    resetAt: resolveNextMonthlyResetAt(now),
    periodKey: state.periodKey
  };
}
