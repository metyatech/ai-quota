/**
 * @metyatech/ai-quota
 *
 * Quota / rate-limit fetching for Claude, Gemini, Copilot, Amazon Q, and Codex.
 * Only fetching is provided here — gate/ramp evaluation logic stays in the caller.
 */

// Shared types
export type { RateLimitWindow, RateLimitSnapshot } from "./types.js";
export type { ClaudeUsageData, ClaudeUsageBucket } from "./types.js";
export type { GeminiUsage, GeminiModelUsage } from "./types.js";
export type { CopilotUsage } from "./types.js";
export type { AmazonQUsageSnapshot } from "./types.js";

// Claude
export { fetchClaudeRateLimits } from "./claude.js";

// Gemini
export { fetchGeminiRateLimits } from "./gemini.js";

// Copilot
export {
  fetchCopilotRateLimits,
  parseCopilotUserInfo,
  parseCopilotQuotaHeader
} from "./copilot.js";
export type { FetchCopilotRateLimitsOptions } from "./copilot.js";

// Amazon Q
export {
  fetchAmazonQRateLimits,
  recordAmazonQUsage,
  loadAmazonQUsageState,
  saveAmazonQUsageState,
  resolveAmazonQUsageStatePath
} from "./amazon-q.js";

// Codex
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
