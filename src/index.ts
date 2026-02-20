/**
 * @metyatech/ai-quota
 *
 * Quota / rate-limit fetching SDK for Claude, Gemini, Copilot, and Codex.
 */

import { fetchClaudeRateLimits } from "./claude.js";
import { fetchGeminiRateLimits } from "./gemini.js";
import { fetchCopilotRateLimits, getCopilotToken } from "./copilot.js";
import { fetchCodexRateLimits, rateLimitSnapshotToStatus } from "./codex.js";
import { formatResetIn } from "./utils.js";
import { isQuotaFetchError } from "./errors.js";
import type {
  AllRateLimits,
  ClaudeUsageData,
  GeminiUsage,
  CopilotUsage,
  RateLimitSnapshot,
  QuotaResult,
  AgentStatus,
  GlobalSummary,
  ErrorReason
} from "./types.js";

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * List of AI agent identifiers supported by this SDK.
 */
export const SUPPORTED_AGENTS = ["claude", "gemini", "copilot", "codex"] as const;

/**
 * Type representing supported agent identifiers.
 */
export type SupportedAgent = (typeof SUPPORTED_AGENTS)[number];

const AGENT_TO_SDK_KEY: Record<SupportedAgent, keyof Omit<AllRateLimits, "summary">> = {
  claude: "claude",
  gemini: "gemini",
  copilot: "copilot",
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
  reason: null,
  error: null,
  display: "skipped"
};

function classifyError(e: unknown): { reason: ErrorReason; message: string } {
  if (isQuotaFetchError(e)) {
    return { reason: e.reason, message: e.message };
  }
  const msg = e instanceof Error ? e.message : String(e);
  let reason: ErrorReason = "unknown";

  if (msg.includes("credentials not found") || msg.includes("no credentials")) {
    reason = "no_credentials";
  } else if (msg.includes("expired")) {
    reason = "token_expired";
  } else if (msg.includes("401") || msg.includes("403") || msg.includes("Forbidden")) {
    reason = "auth_failed";
  } else if (msg.includes("timeout") || msg.includes("AbortError")) {
    reason = "timeout";
  } else if (msg.includes("fetch failed") || msg.includes("Network")) {
    reason = "network_error";
  } else if (msg.includes("failed:") || msg.includes("API Error")) {
    reason = "api_error";
  }

  return { reason, message: msg };
}

function statusForReason(reason: ErrorReason): AgentStatus {
  if (reason === "no_credentials" || reason === "token_expired") return "no-data";
  return "error";
}

function displayForFailure(status: AgentStatus, reason: ErrorReason, message: string | null): string {
  if (status === "no-data") return `no data (${reason})`;
  return message ? `error (${reason}): ${message}` : `error (${reason})`;
}

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
        if (!data) return { status: "no-data", data: null, reason: "unknown", error: null, display: "no data (unknown)" };
        const buckets: string[] = [];
        if (data.five_hour) {
          const resetIn = formatResetIn(new Date(data.five_hour.resets_at));
          buckets.push(`5h: ${Math.round(data.five_hour.utilization)}% used (resets in ${resetIn})`);
        }
        if (data.seven_day) {
          const resetIn = formatResetIn(new Date(data.seven_day.resets_at));
          buckets.push(`7d: ${Math.round(data.seven_day.utilization)}% used (resets in ${resetIn})`);
        }
        return { status: "ok", data, reason: null, error: null, display: buckets.join(", ") || "no data" };
      } catch (e) {
        const { reason, message } = classifyError(e);
        const status = statusForReason(reason);
        return {
          status,
          data: null,
          reason,
          error: status === "error" ? message : null,
          rawError: e,
          display: displayForFailure(status, reason, status === "error" ? message : null)
        };
      }
    },
    gemini: async () => {
      try {
        const data = await fetchGeminiRateLimits(timeout * 1000);
        if (!data) return { status: "no-data", data: null, reason: "unknown", error: null, display: "no data (unknown)" };
        const models: string[] = [];
        const seen = new Set<string>();
        for (const [modelId, usage] of Object.entries(data)) {
          if (!usage) continue;
          // Simplify model names (e.g., "gemini-3-pro-preview" -> "pro")
          const name = modelId.includes("pro") ? "pro" : modelId.includes("flash") ? "flash" : modelId;
          if (seen.has(name)) continue;
          seen.add(name);
          models.push(`${name}: ${Math.round(usage.usage)}% used (resets in ${formatResetIn(usage.resetAt)})`);
        }
        return { status: "ok", data, reason: null, error: null, display: models.join(", ") || "no data" };
      } catch (e) {
        const { reason, message } = classifyError(e);
        const status = statusForReason(reason);
        return {
          status,
          data: null,
          reason,
          error: status === "error" ? message : null,
          rawError: e,
          display: displayForFailure(status, reason, status === "error" ? message : null)
        };
      }
    },
    copilot: async () => {
      try {
        const token = getCopilotToken(verbose);
        if (!token) return { status: "no-data", data: null, reason: "no_credentials", error: null, display: "no data (no_credentials)" };
        const data = await fetchCopilotRateLimits({ token, timeoutSeconds: timeout });
        if (!data) return { status: "error", data: null, reason: "parse_error", error: "Copilot API response missing quota fields.", display: "error (parse_error)" };
        const usedPercent = Math.round(100 - data.percentRemaining);
        return { status: "ok", data, reason: null, error: null, display: `${usedPercent}% used (resets in ${formatResetIn(data.resetAt)})` };
      } catch (e) {
        const { reason, message } = classifyError(e);
        const status = statusForReason(reason);
        return {
          status,
          data: null,
          reason,
          error: status === "error" ? message : null,
          rawError: e,
          display: displayForFailure(status, reason, status === "error" ? message : null)
        };
      }
    },
    codex: async () => {
      try {
        const data = await fetchCodexRateLimits({ timeoutSeconds: timeout });
        if (!data) return { status: "no-data", data: null, reason: "unknown", error: null, display: "no data (unknown)" };
        const status = rateLimitSnapshotToStatus(data);
        if (!status || status.windows.length === 0) return { status: "error", data, reason: "parse_error", error: "Codex usage windows missing.", display: "error (parse_error)" };
        const disp = status.windows
          .map((w) => `${w.label}: ${Math.round(100 - w.percentLeft)}% used (resets in ${formatResetIn(w.resetAt)})`)
          .join(", ");
        return { status: "ok", data, reason: null, error: null, display: disp };
      } catch (e) {
        const { reason, message } = classifyError(e);
        const status = statusForReason(reason);
        return {
          status,
          data: null,
          reason,
          error: status === "error" ? message : null,
          rawError: e,
          display: displayForFailure(status, reason, status === "error" ? message : null)
        };
      }
    }
  };

  const finalResult: AllRateLimits = {
    summary: { status: "healthy", message: "All agents are within limits." },
    claude: DEFAULT_SKIPPED_RESULT as unknown as QuotaResult<ClaudeUsageData>,
    gemini: DEFAULT_SKIPPED_RESULT as unknown as QuotaResult<GeminiUsage>,
    copilot: DEFAULT_SKIPPED_RESULT as unknown as QuotaResult<CopilotUsage>,
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
    // @ts-ignore
    finalResult[sdkKey] = result;

    if (result.status === "error") criticalCount++;
    for (const match of result.display.matchAll(/(\d+)%/g)) {
      const percent = parseInt(match[1] ?? "0", 10);
      if (Number.isFinite(percent)) {
        maxStress = Math.max(maxStress, percent);
      }
    }
  }

  if (criticalCount > 0) {
    finalResult.summary = { status: "critical", message: `${criticalCount} agent(s) failed or are at 100% capacity.` };
  } else if (maxStress >= 80) {
    finalResult.summary = { status: "warning", message: `Usage is high (up to ${maxStress}%).` };
  }

  return finalResult;
}
