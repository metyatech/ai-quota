#!/usr/bin/env node
/**
 * ai-quota CLI
 *
 * Usage:
 *   ai-quota [agent]   Show quota for all agents, or a specific agent
 *   ai-quota --json    Output machine-readable JSON
 *   ai-quota --help    Show help
 *   ai-quota --version Show version
 *
 * Agents: claude, gemini, copilot, amazon-q, codex
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { fetchClaudeRateLimits } from "./claude.js";
import { fetchGeminiRateLimits } from "./gemini.js";
import { fetchCopilotRateLimits } from "./copilot.js";
import { fetchAmazonQRateLimits, resolveAmazonQUsageStatePath } from "./amazon-q.js";
import { fetchCodexRateLimits, rateLimitSnapshotToStatus } from "./codex.js";

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

function getVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(dir, "..", "package.json");
    const pkg = require(pkgPath) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// ---------------------------------------------------------------------------
// Time formatting helpers
// ---------------------------------------------------------------------------

function formatResetIn(resetAt: Date): string {
  const diffMs = resetAt.getTime() - Date.now();
  if (diffMs <= 0) return "already reset";
  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

// ---------------------------------------------------------------------------
// Per-agent result types
// ---------------------------------------------------------------------------

type AgentResult =
  | { status: "ok"; display: string; json: Record<string, unknown> }
  | { status: "no-data"; display: string; json: Record<string, unknown> }
  | { status: "error"; display: string; json: Record<string, unknown> };

// ---------------------------------------------------------------------------
// Copilot: resolve token from env or gh CLI hosts.yml
// ---------------------------------------------------------------------------

function getCopilotToken(): string | null {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const candidates = [
    path.join(os.homedir(), ".config", "gh", "hosts.yml"),
    path.join(os.homedir(), "AppData", "Roaming", "GitHub CLI", "hosts.yml")
  ];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const content = fs.readFileSync(p, "utf8");
      // Simple line-by-line search for oauth_token under github.com
      const match = content.match(/oauth_token:\s*(\S+)/);
      if (match?.[1]) return match[1];
    } catch {
      // ignore
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-agent fetchers
// ---------------------------------------------------------------------------

async function fetchClaude(verbose: boolean): Promise<AgentResult> {
  try {
    const data = await fetchClaudeRateLimits(10000);
    if (!data) {
      return {
        status: "no-data",
        display: "no data",
        json: { error: null, data: null }
      };
    }

    // Use the five_hour bucket as primary display metric
    const bucket = data.five_hour ?? data.seven_day;
    if (!bucket) {
      return {
        status: "no-data",
        display: "no data",
        json: { data }
      };
    }

    const usedPercent = Math.round(bucket.utilization);
    const resetAt = new Date(bucket.resets_at);
    const resetIn = formatResetIn(resetAt);
    const display = `${usedPercent}% used  (resets in ${resetIn})`;

    if (verbose) {
      process.stderr.write(
        `[verbose] claude: five_hour=${JSON.stringify(data.five_hour)} seven_day=${JSON.stringify(data.seven_day)}\n`
      );
    }

    return {
      status: "ok",
      display,
      json: {
        usedPercent,
        resetsAt: resetAt.toISOString(),
        five_hour: data.five_hour,
        seven_day: data.seven_day,
        seven_day_sonnet: data.seven_day_sonnet,
        extra_usage: data.extra_usage
      }
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "error", display: `error: ${msg}`, json: { error: msg } };
  }
}

async function fetchGemini(verbose: boolean): Promise<AgentResult> {
  try {
    const data = await fetchGeminiRateLimits();
    if (!data) {
      return { status: "no-data", display: "no data", json: { error: null, data: null } };
    }

    const pro = data["gemini-3-pro-preview"];
    const flash = data["gemini-3-flash-preview"];
    const primary = pro ?? flash;

    if (!primary) {
      return { status: "no-data", display: "no data", json: { data } };
    }

    const usedPercent = Math.round(primary.usage);
    const resetAt = primary.resetAt;
    const resetIn = formatResetIn(resetAt);
    const display = `${usedPercent}% used  (resets in ${resetIn})`;

    if (verbose) {
      process.stderr.write(
        `[verbose] gemini: pro=${JSON.stringify(pro)} flash=${JSON.stringify(flash)}\n`
      );
    }

    const jsonData: Record<string, unknown> = { usedPercent, resetsAt: resetAt.toISOString() };
    if (pro) {
      jsonData["gemini-3-pro-preview"] = {
        usedPercent: Math.round(pro.usage),
        resetsAt: pro.resetAt.toISOString()
      };
    }
    if (flash) {
      jsonData["gemini-3-flash-preview"] = {
        usedPercent: Math.round(flash.usage),
        resetsAt: flash.resetAt.toISOString()
      };
    }

    return { status: "ok", display, json: jsonData };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "error", display: `error: ${msg}`, json: { error: msg } };
  }
}

async function fetchCopilot(verbose: boolean): Promise<AgentResult> {
  try {
    const token = getCopilotToken();
    if (!token) {
      return {
        status: "no-data",
        display: "no data  (set GITHUB_TOKEN or sign in with gh CLI)",
        json: { error: null, data: null }
      };
    }

    const data = await fetchCopilotRateLimits({ token, timeoutSeconds: 10 });
    if (!data) {
      return { status: "no-data", display: "no data", json: { error: null, data: null } };
    }

    const usedPercent = Math.round(100 - data.percentRemaining);
    const resetIn = formatResetIn(data.resetAt);
    const display = `${usedPercent}% used  (resets in ${resetIn})`;

    if (verbose) {
      process.stderr.write(
        `[verbose] copilot: percentRemaining=${data.percentRemaining} entitlement=${data.entitlement} resetAt=${data.resetAt.toISOString()}\n`
      );
    }

    return {
      status: "ok",
      display,
      json: {
        usedPercent,
        resetsAt: data.resetAt.toISOString(),
        percentRemaining: data.percentRemaining,
        entitlement: data.entitlement,
        overageUsed: data.overageUsed,
        overageEnabled: data.overageEnabled
      }
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "error", display: `error: ${msg}`, json: { error: msg } };
  }
}

async function fetchAmazonQ(verbose: boolean): Promise<AgentResult> {
  try {
    const statePathEnv = process.env.AMAZON_Q_STATE_PATH;
    const statePath = statePathEnv
      ? statePathEnv
      : resolveAmazonQUsageStatePath(os.homedir());
    const monthlyLimit = 50;
    const snapshot = fetchAmazonQRateLimits(statePath, monthlyLimit);

    const display = `${snapshot.used}/${snapshot.limit} requests used`;

    if (verbose) {
      process.stderr.write(
        `[verbose] amazon-q: statePath=${statePath} used=${snapshot.used} limit=${snapshot.limit} period=${snapshot.periodKey}\n`
      );
    }

    return {
      status: "ok",
      display,
      json: {
        used: snapshot.used,
        limit: snapshot.limit,
        percentRemaining: snapshot.percentRemaining,
        resetsAt: snapshot.resetAt.toISOString(),
        periodKey: snapshot.periodKey
      }
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "error", display: `error: ${msg}`, json: { error: msg } };
  }
}

async function fetchCodex(verbose: boolean): Promise<AgentResult> {
  try {
    const snapshot = await fetchCodexRateLimits({ timeoutSeconds: 10 });
    if (!snapshot) {
      return { status: "no-data", display: "no data", json: { error: null, data: null } };
    }

    const status = rateLimitSnapshotToStatus(snapshot);
    if (!status || status.windows.length === 0) {
      return { status: "no-data", display: "no data", json: { error: null, data: null } };
    }

    // Use the shortest window (five-hour) as primary display metric
    const win = status.windows.find((w) => w.key === "fiveHour") ?? status.windows[0];
    if (!win) {
      return { status: "no-data", display: "no data", json: { error: null, data: null } };
    }

    const usedPercent = Math.round(100 - win.percentLeft);
    const resetIn = formatResetIn(win.resetAt);
    const display = `${usedPercent}% used  (resets in ${resetIn})`;

    if (verbose) {
      process.stderr.write(`[verbose] codex: windows=${JSON.stringify(status.windows)}\n`);
    }

    const jsonData: Record<string, unknown> = {
      usedPercent,
      resetsAt: win.resetAt.toISOString()
    };
    for (const w of status.windows) {
      jsonData[w.key] = {
        usedPercent: Math.round(100 - w.percentLeft),
        resetsAt: w.resetAt.toISOString()
      };
    }

    return { status: "ok", display, json: jsonData };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "error", display: `error: ${msg}`, json: { error: msg } };
  }
}

// ---------------------------------------------------------------------------
// All agents registry
// ---------------------------------------------------------------------------

const ALL_AGENTS = ["claude", "gemini", "copilot", "amazon-q", "codex"] as const;
type AgentName = (typeof ALL_AGENTS)[number];

async function runAgent(name: AgentName, verbose: boolean): Promise<AgentResult> {
  switch (name) {
    case "claude":
      return fetchClaude(verbose);
    case "gemini":
      return fetchGemini(verbose);
    case "copilot":
      return fetchCopilot(verbose);
    case "amazon-q":
      return fetchAmazonQ(verbose);
    case "codex":
      return fetchCodex(verbose);
  }
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function padName(name: string): string {
  // Align to the longest agent name ("amazon-q") + colon = 9 chars, then 2 spaces
  return (name + ":").padEnd(11);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // --help / -h
  if (args.includes("--help") || args.includes("-h")) {
    const version = getVersion();
    process.stdout.write(
      `ai-quota v${version}\n\n` +
        "Usage:\n" +
        "  ai-quota [agent]   Show quota for all agents, or a specific agent\n" +
        "  ai-quota --json    Output machine-readable JSON\n" +
        "  ai-quota --quiet   Suppress non-error output\n" +
        "  ai-quota --verbose Show extra debug info on stderr\n" +
        "  ai-quota --help    Show this help message\n" +
        "  ai-quota --version Show version\n\n" +
        "Agents: claude, gemini, copilot, amazon-q, codex\n\n" +
        "Credentials:\n" +
        "  Claude:    ~/.claude/.credentials.json\n" +
        "  Gemini:    ~/.gemini/oauth_creds.json\n" +
        "  Copilot:   GITHUB_TOKEN env var or gh CLI (~/.config/gh/hosts.yml)\n" +
        "  Amazon Q:  AMAZON_Q_STATE_PATH env var (defaults to ~/agent-runner/state/)\n" +
        "  Codex:     ~/.codex/sessions/ or ~/.codex/auth.json\n\n" +
        "Examples:\n" +
        "  ai-quota\n" +
        "  ai-quota claude\n" +
        "  ai-quota --json\n" +
        "  ai-quota copilot --json\n"
    );
    process.exit(0);
  }

  // --version / -V
  if (args.includes("--version") || args.includes("-V")) {
    process.stdout.write(`${getVersion()}\n`);
    process.exit(0);
  }

  const jsonMode = args.includes("--json");
  const quiet = args.includes("--quiet");
  const verbose = args.includes("--verbose");

  // Collect positional agent names (everything not a flag)
  const positional = args.filter(
    (a) => !a.startsWith("--") && a !== "-h" && a !== "-V"
  );

  // Validate agent names
  const requested: AgentName[] = [];
  for (const a of positional) {
    if (!(ALL_AGENTS as readonly string[]).includes(a)) {
      process.stderr.write(
        `ai-quota: unknown agent '${a}'. Valid agents: ${ALL_AGENTS.join(", ")}\n`
      );
      process.exit(1);
    }
    requested.push(a as AgentName);
  }

  const agentsToRun: AgentName[] = requested.length > 0 ? requested : [...ALL_AGENTS];

  // Run all fetchers in parallel
  const results = await Promise.all(
    agentsToRun.map(async (name) => ({
      name,
      result: await runAgent(name, verbose)
    }))
  );

  let anyError = false;

  if (jsonMode) {
    const out: Record<string, unknown> = {};
    for (const { name, result } of results) {
      out[name] = result.json;
      if (result.status === "error") anyError = true;
    }
    if (!quiet) {
      process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    }
  } else {
    for (const { name, result } of results) {
      if (result.status === "error") anyError = true;
      if (!quiet) {
        process.stdout.write(`${padName(name)} ${result.display}\n`);
      }
    }
  }

  process.exit(anyError ? 1 : 0);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `ai-quota: fatal error: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
