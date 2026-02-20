import type {
  AllRateLimits,
  ClaudeUsageData,
  GeminiUsage,
  RateLimitSnapshot,
  QuotaResult,
  CopilotUsage,
  AmazonQUsageSnapshot
} from "./types.js";
import type { SupportedAgent } from "./index.js";
import { formatResetIn } from "./utils.js";
import { rateLimitSnapshotToStatus } from "./codex.js";

export type HumanStatus =
  | "CAN_USE"
  | "LOW_QUOTA"
  | "WAIT_RESET"
  | "LOGIN_REQUIRED"
  | "FETCH_FAILED";

export type HumanLimit = "7d" | "5h" | "pro" | "flash" | "-";

export type HumanRow = {
  agent: string;
  status: HumanStatus;
  limit: HumanLimit;
  details: string;
};

type UsageWindow = {
  label: "5h" | "7d";
  usedPercent: number;
  resetAt: Date;
};

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function compareMostConstraining(a: UsageWindow, b: UsageWindow): number {
  if (a.usedPercent !== b.usedPercent) return b.usedPercent - a.usedPercent;
  return a.resetAt.getTime() - b.resetAt.getTime();
}

function deriveStatusFromUsedPercent(usedPercent: number): HumanStatus {
  const clamped = clampPercent(usedPercent);
  if (clamped >= 100) return "WAIT_RESET";
  if (clamped >= 80) return "LOW_QUOTA";
  return "CAN_USE";
}

function deriveStatusFromResult(result: QuotaResult<unknown>, usedPercent: number | null): HumanStatus {
  if (result.status === "error") {
    if (result.reason === "auth_failed" || result.reason === "no_credentials") return "LOGIN_REQUIRED";
    return "FETCH_FAILED";
  }

  if (result.status === "no-data") {
    if (result.reason === "no_credentials" || result.reason === "auth_failed") return "LOGIN_REQUIRED";
    return "FETCH_FAILED";
  }

  if (usedPercent === null) return "FETCH_FAILED";
  return deriveStatusFromUsedPercent(usedPercent);
}

function formatWindowDetails(windows: UsageWindow[], now: Date): string {
  return windows
    .map((w) => `${w.label}: ${w.usedPercent}% used (reset in ${formatResetIn(w.resetAt, now)})`)
    .join(", ");
}

function buildClaudeRow(
  result: QuotaResult<ClaudeUsageData>,
  now: Date
): { status: HumanStatus; limit: HumanLimit; details: string } {
  const windows: UsageWindow[] = [];

  const data = result.data;
  if (data?.five_hour) {
    const resetAt = new Date(data.five_hour.resets_at);
    if (Number.isFinite(resetAt.getTime())) {
      windows.push({
        label: "5h",
        usedPercent: clampPercent(Math.round(data.five_hour.utilization)),
        resetAt
      });
    }
  }

  if (data?.seven_day) {
    const resetAt = new Date(data.seven_day.resets_at);
    if (Number.isFinite(resetAt.getTime())) {
      windows.push({
        label: "7d",
        usedPercent: clampPercent(Math.round(data.seven_day.utilization)),
        resetAt
      });
    }
  }

  windows.sort(compareMostConstraining);

  const limitingUsed = windows.length > 0 ? windows[0]!.usedPercent : null;
  const status = deriveStatusFromResult(result as unknown as QuotaResult<unknown>, limitingUsed);

  if (status === "LOGIN_REQUIRED") return { status, limit: "-", details: "login required" };
  if (status === "FETCH_FAILED") {
    return {
      status,
      limit: "-",
      details: result.reason ? `fetch failed (${result.reason})` : "fetch failed"
    };
  }

  const limit: HumanLimit = windows.length > 0 ? windows[0]!.label : "-";
  const details = windows.length > 0 ? formatWindowDetails(windows, now) : "no data";
  return { status, limit, details };
}

function buildCodexRow(
  result: QuotaResult<RateLimitSnapshot>,
  now: Date
): { status: HumanStatus; limit: HumanLimit; details: string } {
  const data = result.data;
  const statusObj = data ? rateLimitSnapshotToStatus(data, now) : null;
  const windows: UsageWindow[] = [];

  for (const w of statusObj?.windows ?? []) {
    const usedPercent = clampPercent(Math.round(100 - w.percentLeft));
    if (w.label === "5h" || w.label === "7d") {
      windows.push({ label: w.label, usedPercent, resetAt: w.resetAt });
    }
  }

  windows.sort(compareMostConstraining);

  const limitingUsed = windows.length > 0 ? windows[0]!.usedPercent : null;
  const status = deriveStatusFromResult(result as unknown as QuotaResult<unknown>, limitingUsed);

  if (status === "LOGIN_REQUIRED") return { status, limit: "-", details: "login required" };
  if (status === "FETCH_FAILED") {
    return {
      status,
      limit: "-",
      details: result.reason ? `fetch failed (${result.reason})` : "fetch failed"
    };
  }

  const limit: HumanLimit = windows.length > 0 ? windows[0]!.label : "-";
  const details = windows.length > 0 ? formatWindowDetails(windows, now) : "no data";
  return { status, limit, details };
}

function buildCopilotRow(
  result: QuotaResult<CopilotUsage>,
  now: Date
): { status: HumanStatus; limit: HumanLimit; details: string } {
  const data = result.data;
  const usedPercent = data ? clampPercent(Math.round(100 - data.percentRemaining)) : null;
  const status = deriveStatusFromResult(result as unknown as QuotaResult<unknown>, usedPercent);

  if (status === "LOGIN_REQUIRED") return { status, limit: "-", details: "login required" };
  if (status === "FETCH_FAILED") {
    return {
      status,
      limit: "-",
      details: result.reason ? `fetch failed (${result.reason})` : "fetch failed"
    };
  }

  if (!data) return { status: "FETCH_FAILED", limit: "-", details: "no data" };
  return {
    status,
    limit: "-",
    details: `${usedPercent}% used (reset in ${formatResetIn(data.resetAt, now)})`
  };
}

function buildAmazonQRow(
  result: QuotaResult<AmazonQUsageSnapshot>,
  now: Date
): { status: HumanStatus; limit: HumanLimit; details: string } {
  const data = result.data;
  const usedPercent = data ? clampPercent(Math.round(100 - data.percentRemaining)) : null;
  const status = deriveStatusFromResult(result as unknown as QuotaResult<unknown>, usedPercent);

  if (status === "LOGIN_REQUIRED") return { status, limit: "-", details: "login required" };
  if (status === "FETCH_FAILED") {
    return {
      status,
      limit: "-",
      details: result.reason ? `fetch failed (${result.reason})` : "fetch failed"
    };
  }

  if (!data) return { status: "FETCH_FAILED", limit: "-", details: "no data" };

  const safeLimit = data.limit > 0 ? data.limit : 0;
  const safeUsed = data.used >= 0 ? data.used : 0;
  const computedUsedPercent =
    safeLimit > 0 ? clampPercent(Math.round((safeUsed / safeLimit) * 100)) : 0;

  return {
    status,
    limit: "-",
    details: `${safeUsed}/${safeLimit} requests used (${computedUsedPercent}% used, reset in ${formatResetIn(
      data.resetAt,
      now
    )})`
  };
}

function classifyGeminiModelId(modelId: string): { agentSuffix: "pro" | "flash" | null; limit: HumanLimit } {
  if (modelId.includes("pro")) return { agentSuffix: "pro", limit: "pro" };
  if (modelId.includes("flash")) return { agentSuffix: "flash", limit: "flash" };
  return { agentSuffix: null, limit: "-" };
}

function buildGeminiRows(
  result: QuotaResult<GeminiUsage>,
  now: Date
): HumanRow[] {
  const data = result.data;

  if (result.status !== "ok") {
    const status = deriveStatusFromResult(result as unknown as QuotaResult<unknown>, null);
    const details =
      status === "LOGIN_REQUIRED"
        ? "login required"
        : result.reason
          ? `fetch failed (${result.reason})`
          : "fetch failed";
    return [{ agent: "gemini", status, limit: "-", details }];
  }

  const rows: HumanRow[] = [];
  const seenSuffix = new Set<string>();

  for (const [modelId, usage] of Object.entries(data ?? {})) {
    if (!usage) continue;
    const { agentSuffix, limit } = classifyGeminiModelId(modelId);
    if (!agentSuffix) continue;
    if (seenSuffix.has(agentSuffix)) continue;
    seenSuffix.add(agentSuffix);

    const usedPercent = clampPercent(Math.round(usage.usage));
    const status = deriveStatusFromUsedPercent(usedPercent);

    rows.push({
      agent: `gemini/${agentSuffix}`,
      status,
      limit,
      details: `${usedPercent}% used (reset in ${formatResetIn(usage.resetAt, now)})`
    });
  }

  if (rows.length === 0) {
    return [{ agent: "gemini", status: "FETCH_FAILED", limit: "-", details: "no data" }];
  }

  // Stable output ordering: pro then flash (regardless of used%)
  rows.sort((a, b) => {
    const aRank = a.limit === "pro" ? 0 : a.limit === "flash" ? 1 : 2;
    const bRank = b.limit === "pro" ? 0 : b.limit === "flash" ? 1 : 2;
    if (aRank !== bRank) return aRank - bRank;
    return a.agent.localeCompare(b.agent);
  });
  return rows;
}

export function buildHumanRows(
  allResults: AllRateLimits,
  options: { agents: SupportedAgent[]; now?: Date }
): HumanRow[] {
  const now = options.now ?? new Date();
  const rows: HumanRow[] = [];

  for (const agent of options.agents) {
    if (agent === "claude") {
      const row = buildClaudeRow(allResults.claude, now);
      rows.push({ agent: "claude", ...row });
      continue;
    }

    if (agent === "codex") {
      const row = buildCodexRow(allResults.codex, now);
      rows.push({ agent: "codex", ...row });
      continue;
    }

    if (agent === "gemini") {
      rows.push(...buildGeminiRows(allResults.gemini, now));
      continue;
    }

    if (agent === "copilot") {
      const row = buildCopilotRow(allResults.copilot, now);
      rows.push({ agent: "copilot", ...row });
      continue;
    }

    if (agent === "amazon-q") {
      const row = buildAmazonQRow(allResults.amazonQ, now);
      rows.push({ agent: "amazon-q", ...row });
      continue;
    }
  }

  return rows;
}

export function formatHumanTable(rows: HumanRow[]): string {
  const headers = ["AGENT", "STATUS", "LIMIT", "DETAILS"] as const;
  const cells = rows.map((r) => [r.agent, r.status, r.limit, r.details] as const);

  const widths = headers.map((h, i) => {
    let max = h.length;
    for (const row of cells) max = Math.max(max, String(row[i]).length);
    return max;
  });

  const pad = (value: string, width: number) => value.padEnd(width);

  const lines: string[] = [];
  lines.push(headers.map((h, i) => pad(h, widths[i]!)).join("  "));
  lines.push(widths.map((w) => "-".repeat(w)).join("  "));

  for (const r of rows) {
    const line =
      pad(r.agent, widths[0]!) +
      "  " +
      pad(r.status, widths[1]!) +
      "  " +
      pad(r.limit, widths[2]!) +
      "  " +
      r.details;
    lines.push(line);
  }

  return lines.join("\n");
}
