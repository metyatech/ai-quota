/**
 * @metyatech/ai-quota
 *
 * Quota / rate-limit fetching for Claude, Gemini, Copilot, Amazon Q, and Codex.
 * Only fetching is provided here — gate/ramp evaluation logic stays in the caller.
 */

import os from "node:os";
import { fetchClaudeRateLimits } from "./claude.js";
import { fetchGeminiRateLimits } from "./gemini.js";
import { fetchCopilotRateLimits, getCopilotToken } from "./copilot.js";
import { fetchAmazonQRateLimits, resolveAmazonQUsageStatePath } from "./amazon-q.js";
import { fetchCodexRateLimits, rateLimitSnapshotToStatus } from "./codex.js";
import { formatResetIn } from "./utils.js";
import type {
  AllRateLimits,
  ClaudeUsageData,
  GeminiUsage,
  CopilotUsage,
  AmazonQUsageSnapshot,
  RateLimitSnapshot,
  QuotaResult
} from "./types.js";

// Shared types
export type * from "./types.js";

// Individual fetchers
export { fetchClaudeRateLimits } from "./claude.js";
export { fetchGeminiRateLimits } from "./gemini.js";
export {
  fetchCopilotRateLimits,
  parseCopilotUserInfo,
  parseCopilotQuotaHeader,
  getCopilotToken
} from "./copilot.js";
export type { FetchCopilotRateLimitsOptions } from "./copilot.js";
export {
  fetchAmazonQRateLimits,
  recordAmazonQUsage,
  loadAmazonQUsageState,
  saveAmazonQUsageState,
  resolveAmazonQUsageStatePath
} from "./amazon-q.js";
export {
  fetchCodexRateLimits,
  rateLimitSnapshotToStatus
} from "./codex.js";
export type {
  CodexStatus,
  UsageWindow,
  UsageWindowKey,
  FetchCodexRateLimitsOptions
} from "./codex.js";

// ---------------------------------------------------------------------------
// High-level Orchestration API
// ---------------------------------------------------------------------------

/**
 * Fetches quota/usage for all supported agents using default credential discovery.
 */
export async function fetchAllRateLimits(options?: {
  verbose?: boolean;
  timeoutSeconds?: number;
}): Promise<AllRateLimits> {
  const verbose = options?.verbose ?? false;
  const timeout = options?.timeoutSeconds ?? 10;

  const results = await Promise.allSettled([
    // Claude
    (async (): Promise<QuotaResult<ClaudeUsageData>> => {
      try {
        const data = await fetchClaudeRateLimits(timeout * 1000);
        if (!data) return { status: "no-data", data: null, error: null, display: "no data" };
        const buckets: string[] = [];
        if (data.five_hour) {
          const resetIn = formatResetIn(new Date(data.five_hour.resets_at));
          buckets.push(`5h: ${Math.round(data.five_hour.utilization)}% (resets in ${resetIn})`);
        }
        if (data.seven_day) {
          const resetIn = formatResetIn(new Date(data.seven_day.resets_at));
          buckets.push(`7d: ${Math.round(data.seven_day.utilization)}% (resets in ${resetIn})`);
        }
        return { status: "ok", data, error: null, display: buckets.join(", ") || "no data" };
      } catch (e) {
        return { status: "error", data: null, error: String(e), display: `error: ${e}` };
      }
    })(),

    // Gemini
    (async (): Promise<QuotaResult<GeminiUsage>> => {
      try {
        const data = await fetchGeminiRateLimits();
        if (!data) return { status: "no-data", data: null, error: null, display: "no data" };
        const models: string[] = [];
        const pro = data["gemini-3-pro-preview"];
        const flash = data["gemini-3-flash-preview"];
        if (pro) models.push(`Pro: ${Math.round(pro.usage)}% (resets in ${formatResetIn(pro.resetAt)})`);
        if (flash) models.push(`Flash: ${Math.round(flash.usage)}% (resets in ${formatResetIn(flash.resetAt)})`);
        return { status: "ok", data, error: null, display: models.join(", ") || "no data" };
      } catch (e) {
        return { status: "error", data: null, error: String(e), display: `error: ${e}` };
      }
    })(),

    // Copilot
    (async (): Promise<QuotaResult<CopilotUsage>> => {
      try {
        const token = getCopilotToken(verbose);
        if (!token) return { status: "no-data", data: null, error: null, display: "no data (auth required)" };
        const data = await fetchCopilotRateLimits({ token, timeoutSeconds: timeout });
        if (!data) return { status: "no-data", data: null, error: null, display: "no data" };
        const usedPercent = Math.round(100 - data.percentRemaining);
        return { status: "ok", data, error: null, display: `${usedPercent}% used (resets in ${formatResetIn(data.resetAt)})` };
      } catch (e) {
        return { status: "error", data: null, error: String(e), display: `error: ${e}` };
      }
    })(),

    // Amazon Q
    (async (): Promise<QuotaResult<AmazonQUsageSnapshot>> => {
      try {
        const statePath = resolveAmazonQUsageStatePath(os.homedir());
        const data = fetchAmazonQRateLimits(statePath, 50);
        return { status: "ok", data, error: null, display: `${data.used}/${data.limit} requests used` };
      } catch (e) {
        return { status: "error", data: null, error: String(e), display: `error: ${e}` };
      }
    })(),

    // Codex
    (async (): Promise<QuotaResult<RateLimitSnapshot>> => {
      try {
        const data = await fetchCodexRateLimits({ timeoutSeconds: timeout });
        if (!data) return { status: "no-data", data: null, error: null, display: "no data" };
        const status = rateLimitSnapshotToStatus(data);
        if (!status || status.windows.length === 0) return { status: "no-data", data, error: null, display: "no data" };
        const disp = status.windows.map(w => `${w.label}: ${Math.round(100 - w.percentLeft)}% (resets in ${formatResetIn(w.resetAt)})`).join(", ");
        return { status: "ok", data, error: null, display: disp };
      } catch (e) {
        return { status: "error", data: null, error: String(e), display: `error: ${e}` };
      }
    })()
  ]);

  const [claude, gemini, copilot, amazonQ, codex] = results.map(r => 
    r.status === "fulfilled" ? r.value : { status: "error" as const, data: null, error: "Task failed", display: "error" }
  );

  return {
    claude: claude as QuotaResult<ClaudeUsageData>,
    gemini: gemini as QuotaResult<GeminiUsage>,
    copilot: copilot as QuotaResult<CopilotUsage>,
    amazonQ: amazonQ as QuotaResult<AmazonQUsageSnapshot>,
    codex: codex as QuotaResult<RateLimitSnapshot>
  };
}
