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

export type RateLimitWindow = {
  usedPercent?: number;
  used_percent?: number;
  windowDurationMins?: number | null;
  window_minutes?: number | null;
  windowMinutes?: number | null;
  resetsAt?: number | null;
  resets_at?: number | null;
};

export type RateLimitSnapshot = {
  primary?: RateLimitWindow | null;
  secondary?: RateLimitWindow | null;
  credits?: unknown;
  planType?: string | null;
  plan_type?: string | null;
};

// ---------------------------------------------------------------------------
// Claude types
// ---------------------------------------------------------------------------

export type ClaudeUsageBucket = {
  utilization: number; // 0-100
  resets_at: string; // ISO 8601
};

export type ClaudeUsageData = {
  five_hour: ClaudeUsageBucket | null;
  seven_day: ClaudeUsageBucket | null;
  seven_day_sonnet: ClaudeUsageBucket | null;
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

export type GeminiModelUsage = {
  limit: number;
  usage: number;
  resetAt: Date;
};

export type GeminiUsage = {
  "gemini-3-pro-preview"?: GeminiModelUsage;
  "gemini-3-flash-preview"?: GeminiModelUsage;
};

// ---------------------------------------------------------------------------
// Copilot types
// ---------------------------------------------------------------------------

export type CopilotUsage = {
  percentRemaining: number;
  resetAt: Date;
  entitlement: number;
  overageUsed: number;
  overageEnabled: boolean;
  source: "user" | "header";
  raw: unknown;
};

// ---------------------------------------------------------------------------
// Amazon Q types
// ---------------------------------------------------------------------------

export type AmazonQUsageSnapshot = {
  used: number;
  limit: number;
  percentRemaining: number;
  resetAt: Date;
  periodKey: string;
};
