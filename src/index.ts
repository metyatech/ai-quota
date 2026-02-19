/**
 * @metyatech/ai-quota
 *
 * Quota / rate-limit fetching SDK for Claude, Gemini, Copilot, Amazon Q, and Codex.
 */

import os from "node:os";
import { fetchClaudeRateLimits } from "./claude.js";
import { fetchGeminiRateLimits } from "./gemini.js";
import { fetchCopilotRateLimits, getCopilotToken } from "./copilot.js";
import {
  fetchAmazonQRateLimits,
  resolveAmazonQUsageStatePath,
  DEFAULT_AMAZON_Q_MONTHLY_LIMIT
} from "./amazon-q.js";
import { fetchCodexRateLimits, rateLimitSnapshotToStatus } from "./codex.js";
import { formatResetIn } from "./utils.js";
import type {
  AllRateLimits,
  ClaudeUsageData,
  GeminiUsage,
  CopilotUsage,
  AmazonQUsageSnapshot,
  RateLimitSnapshot,
  QuotaResult,
  AgentStatus,
  GlobalSummary
} from "./types.js";

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * List of AI agent identifiers supported by this SDK.
 */
export const SUPPORTED_AGENTS = ["claude", "gemini", "copilot", "amazon-q", "codex"] as const;

/**
 * Type representing supported agent identifiers.
 */
export type SupportedAgent = (typeof SUPPORTED_AGENTS)[number];

const AGENT_TO_SDK_KEY: Record<SupportedAgent, keyof Omit<AllRateLimits, "summary">> = {
  claude: "claude",
  gemini: "gemini",
  copilot: "copilot",
  "amazon-q": "amazonQ",
  codex: "codex"
};

/**
 * Maps a SupportedAgent name to its corresponding key in AllRateLimits.
 */
export function agentToSdkKey(agent: SupportedAgent): keyof Omit<AllRateLimits, "summary"> {
  return AGENT_TO_SDK_KEY[agent];
}

// Shared types
export type * from "./types.js";

// Utilities
export { formatResetIn } from "./utils.js";

// MCP
export { runMcpServer } from "./mcp.js";

// Individual fetchers & helpers
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
  resolveAmazonQUsageStatePath,
  DEFAULT_AMAZON_Q_MONTHLY_LIMIT
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
// High-level Orchestration API Implementation
// ---------------------------------------------------------------------------

const DEFAULT_SKIPPED_RESULT: QuotaResult<null> = {
  status: "no-data",
  data: null,
  error: null,
  display: "skipped"
};

/**
 * Fetches quota/usage for specified agents (or all by default) using default credential discovery.
 * 
 * @param options - Configuration options for the fetch operation
 * @param options.agents - List of specific agents to fetch. If omitted, all agents are fetched.
 * @param options.verbose - Enable detailed logging to stderr
 * @param options.timeoutSeconds - Global timeout for network requests (default: 10s)
 * @returns A structured object containing quota information for the requested agents
 */
export async function fetchAllRateLimits(options?: {
  agents?: SupportedAgent[];
  verbose?: boolean;
  timeoutSeconds?: number;
}): Promise<AllRateLimits> {
  const verbose = options?.verbose ?? false;
  const timeout = options?.timeoutSeconds ?? 10;
  const agentsToFetch = options?.agents ?? [...SUPPORTED_AGENTS];

  const fetchers: Record<SupportedAgent, () => Promise<QuotaResult<any>>> = {
    claude: async () => {
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
    },
    gemini: async () => {
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
    },
    copilot: async () => {
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
    },
    "amazon-q": async () => {
      try {
        const envPath = process.env.AMAZON_Q_STATE_PATH;
        const statePath = envPath ? envPath : resolveAmazonQUsageStatePath(os.homedir());
        const data = fetchAmazonQRateLimits(statePath, DEFAULT_AMAZON_Q_MONTHLY_LIMIT);
        return { status: "ok", data, error: null, display: `${data.used}/${data.limit} requests used` };
      } catch (e) {
        return { status: "error", data: null, error: String(e), display: `error: ${e}` };
      }
    },
    codex: async () => {
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
    }
  };

  const finalResult: AllRateLimits = {
    summary: { status: "healthy", message: "All agents are within limits." },
    claude: DEFAULT_SKIPPED_RESULT as unknown as QuotaResult<ClaudeUsageData>,
    gemini: DEFAULT_SKIPPED_RESULT as unknown as QuotaResult<GeminiUsage>,
    copilot: DEFAULT_SKIPPED_RESULT as unknown as QuotaResult<CopilotUsage>,
    amazonQ: DEFAULT_SKIPPED_RESULT as unknown as QuotaResult<AmazonQUsageSnapshot>,
    codex: DEFAULT_SKIPPED_RESULT as unknown as QuotaResult<RateLimitSnapshot>
  };

  const results = await Promise.all(agentsToFetch.map(async (name) => {
    const result = await fetchers[name]();
    return { name, result };
  }));

  let maxStress = 0;
  let criticalCount = 0;

  for (const { name, result } of results) {
    const sdkKey = agentToSdkKey(name);
    // @ts-ignore - Result mapping is internally consistent but TS can't trace the generic T through the fetchers map
    finalResult[sdkKey] = result;

    // Calculate overall status
    if (result.status === "error") criticalCount++;
    const match = result.display.match(/(\d+)%/);
    if (match) {
      const percent = parseInt(match[1], 10);
      maxStress = Math.max(maxStress, percent);
    }
  }

  if (criticalCount > 0) {
    finalResult.summary = { status: "critical", message: `${criticalCount} agent(s) failed or are at 100% capacity.` };
  } else if (maxStress >= 80) {
    finalResult.summary = { status: "warning", message: `Usage is high (up to ${maxStress}%).` };
  }

  return finalResult;
}
