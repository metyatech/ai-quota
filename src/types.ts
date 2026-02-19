/**
 * Shared types for @metyatech/ai-quota.
 *
 * These types are intentionally kept compatible with the agent-runner
 * usage types so that migration from local files to this package is
 * a drop-in replacement.
 */

// ---------------------------------------------------------------------------
// Codex / generic rate-limit types
// ---------------------------------------------------------------------------

/**
 * Represents a specific rate limit window (e.g., 5-hour or weekly).
 */
export type RateLimitWindow = {
  /** Percentage of quota used (0-100) */
  usedPercent?: number;
  /** Legacy snake_case version of usedPercent */
  used_percent?: number;
  /** Duration of the window in minutes */
  windowDurationMins?: number | null;
  /** Window duration in minutes (snake_case) */
  window_minutes?: number | null;
  /** Legacy camelCase version of windowMinutes */
  windowMinutes?: number | null;
  /** Unix timestamp (seconds) when the limit resets */
  resetsAt?: number | null;
  /** Legacy snake_case version of resetsAt */
  resets_at?: number | null;
};

/**
 * A collection of rate limit windows for a specific agent.
 */
export type RateLimitSnapshot = {
  /** Primary limit window (usually the shortest/strictest) */
  primary?: RateLimitWindow | null;
  /** Secondary limit window (usually longer-term) */
  secondary?: RateLimitWindow | null;
  /** Optional credit/balance information */
  credits?: unknown;
  /** Plan type information (e.g., "pro", "free") */
  planType?: string | null;
  /** Legacy snake_case version of planType */
  plan_type?: string | null;
};

// ---------------------------------------------------------------------------
// Claude types
// ---------------------------------------------------------------------------

/**
 * A usage bucket for Anthropic Claude.
 */
export type ClaudeUsageBucket = {
  /** Usage percentage (0-100) */
  utilization: number;
  /** ISO 8601 timestamp of reset time */
  resets_at: string;
};

/**
 * Aggregated usage data for Claude.
 */
export type ClaudeUsageData = {
  /** The 5-hour rolling window limit */
  five_hour: ClaudeUsageBucket | null;
  /** The 7-day rolling window limit */
  seven_day: ClaudeUsageBucket | null;
  /** Specific 7-day limit for Sonnet models */
  seven_day_sonnet: ClaudeUsageBucket | null;
  /** Information about extra usage/credits beyond the base plan */
  extra_usage: {
    is_enabled: boolean;
    monthly_limit: number | null;
    used_credits: number;
    utilization: number;
  } | null;
};

// ---------------------------------------------------------------------------
// Gemini types
// ---------------------------------------------------------------------------

/**
 * Model-specific usage data for Google Gemini.
 */
export type GeminiModelUsage = {
  /** Maximum allowed requests/tokens in the window */
  limit: number;
  /** Current usage (not necessarily a percentage, context-dependent) */
  usage: number;
  /** Reset date */
  resetAt: Date;
};

/**
 * Aggregated usage data for Gemini models.
 */
export type GeminiUsage = {
  "gemini-3-pro-preview"?: GeminiModelUsage;
  "gemini-3-flash-preview"?: GeminiModelUsage;
  /** Allow for other dynamic model IDs */
  [modelId: string]: GeminiModelUsage | undefined;
};

// ---------------------------------------------------------------------------
// Copilot types
// ---------------------------------------------------------------------------

/**
 * Usage data for GitHub Copilot.
 */
export type CopilotUsage = {
  /** Percentage of premium quota remaining (0-100) */
  percentRemaining: number;
  /** Date when the quota resets (usually monthly) */
  resetAt: Date;
  /** Total entitlement (count of requests or tokens) */
  entitlement: number;
  /** Amount used above the base entitlement */
  overageUsed: number;
  /** Whether overage is currently allowed/enabled */
  overageEnabled: boolean;
  /** Source of the data (internal API body or response header) */
  source: "user" | "header";
  /** Raw response data for debugging */
  raw: unknown;
};

// ---------------------------------------------------------------------------
// Amazon Q types
// ---------------------------------------------------------------------------

/**
 * Usage snapshot for Amazon Q Developer.
 */
export type AmazonQUsageSnapshot = {
  /** Number of requests used in the current period */
  used: number;
  /** Total requests allowed per period */
  limit: number;
  /** Percentage of quota remaining (0-100) */
  percentRemaining: number;
  /** Date when the limit is expected to reset */
  resetAt: Date;
  /** Key identifying the current usage period (e.g., "2026-02") */
  periodKey: string;
};

// ---------------------------------------------------------------------------
// Aggregated types
// ---------------------------------------------------------------------------

/**
 * Status of an agent fetch operation.
 */
export type AgentStatus = "ok" | "no-data" | "error";

/**
 * Standard error reasons for a failed fetch operation.
 */
export type ErrorReason = 
  | "auth_failed" 
  | "network_error" 
  | "api_error" 
  | "no_credentials" 
  | "timeout" 
  | "unknown";

/**
 * Generic result wrapper for a single agent's quota information.
 */
export type QuotaResult<T> = {
  /** Fetch status */
  status: AgentStatus;
  /** The actual quota data, or null if fetch failed or no data was found */
  data: T | null;
  /** Primary error reason code */
  reason: ErrorReason | null;
  /** Error message if status is "error" */
  error: string | null;
  /** Optional raw error object for deeper inspection */
  rawError?: unknown;
  /** Human-readable display string summarizing the status */
  display: string;
};

/**
 * Summary of the overall health status of all quotas.
 */
export type GlobalSummary = {
  /** Overall status: "healthy", "warning", or "critical" */
  status: "healthy" | "warning" | "critical";
  /** A human-readable message summarizing the overall state */
  message: string;
};

/**
 * Complete set of rate limits for all supported AI agents.
 */
export type AllRateLimits = {
  /** Overall summary of the quota health */
  summary: GlobalSummary;
  claude: QuotaResult<ClaudeUsageData>;
  gemini: QuotaResult<GeminiUsage>;
  copilot: QuotaResult<CopilotUsage>;
  amazonQ: QuotaResult<AmazonQUsageSnapshot>;
  codex: QuotaResult<RateLimitSnapshot>;
};
