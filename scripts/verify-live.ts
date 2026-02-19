/**
 * Live verification script for @metyatech/ai-quota fetchers.
 *
 * Run with: npx ts-node --esm scripts/verify-live.ts
 * Or after build: node dist/scripts/verify-live.js
 *
 * This script is NOT automated comparison — it is for the user to manually
 * inspect the raw output and verify it matches expected values.
 *
 * Required credentials:
 *   Claude:    ~/.claude/.credentials.json
 *   Gemini:    ~/.gemini/oauth_creds.json
 *   Copilot:   GITHUB_TOKEN env var or ~/.config/gh/hosts.yml
 *   Amazon Q:  AMAZON_Q_STATE_PATH env var (pass as env), otherwise defaults to
 *              ~/agent-runner/state/amazon-q-usage.json
 *   Codex:     ~/.codex/sessions/ directory or ~/.codex/auth.json
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fetchClaudeRateLimits } from "../src/claude.js";
import { fetchGeminiRateLimits } from "../src/gemini.js";
import { fetchCopilotRateLimits } from "../src/copilot.js";
import {
  fetchAmazonQRateLimits,
  resolveAmazonQUsageStatePath
} from "../src/amazon-q.js";
import { fetchCodexRateLimits, rateLimitSnapshotToStatus } from "../src/codex.js";

function separator(title: string): void {
  const line = "─".repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  console.log(line);
}

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
      const match = content.match(/oauth_token:\s*(\S+)/);
      if (match?.[1]) return match[1];
    } catch {
      // ignore
    }
  }
  return null;
}

async function verifyClaude(): Promise<void> {
  separator("Claude — fetchClaudeRateLimits()");
  try {
    const result = await fetchClaudeRateLimits(10000);
    if (result === null) {
      console.log("Result: null (no credentials or fetch failed)");
      console.log("  Expected source: ~/.claude/.credentials.json");
    } else {
      console.log("Result:", JSON.stringify(result, null, 2));
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

async function verifyGemini(): Promise<void> {
  separator("Gemini — fetchGeminiRateLimits()");
  try {
    const result = await fetchGeminiRateLimits();
    if (result === null) {
      console.log("Result: null (no credentials or fetch failed)");
      console.log("  Expected source: ~/.gemini/oauth_creds.json");
      console.log(
        "  Optional env:  AGENT_RUNNER_GEMINI_OAUTH_CLIENT_ID, AGENT_RUNNER_GEMINI_OAUTH_CLIENT_SECRET"
      );
    } else {
      console.log("Result:", JSON.stringify(result, null, 2));
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

async function verifyCopilot(): Promise<void> {
  separator("Copilot — fetchCopilotRateLimits()");
  const token = getCopilotToken();
  if (!token) {
    console.log("Skipped: no GITHUB_TOKEN env var and no gh CLI token found.");
    console.log("  Set GITHUB_TOKEN or sign in with: gh auth login");
    return;
  }
  console.log("Using token source:", process.env.GITHUB_TOKEN ? "GITHUB_TOKEN env" : "gh CLI hosts.yml");
  try {
    const result = await fetchCopilotRateLimits({ token, timeoutSeconds: 10 });
    if (result === null) {
      console.log("Result: null (API returned no usable data)");
    } else {
      console.log("Result:", JSON.stringify(result, null, 2));
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

async function verifyAmazonQ(): Promise<void> {
  separator("Amazon Q — fetchAmazonQRateLimits()");
  const statePathEnv = process.env.AMAZON_Q_STATE_PATH;
  const statePath = statePathEnv
    ? statePathEnv
    : resolveAmazonQUsageStatePath(os.homedir());
  const monthlyLimit = 50;
  console.log("State path:", statePath);
  console.log("  (override with AMAZON_Q_STATE_PATH env var)");
  try {
    const result = fetchAmazonQRateLimits(statePath, monthlyLimit);
    console.log("Result:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Error:", err);
  }
}

async function verifyCodex(): Promise<void> {
  separator("Codex — fetchCodexRateLimits()");
  try {
    const snapshot = await fetchCodexRateLimits({ timeoutSeconds: 10 });
    if (snapshot === null) {
      console.log("Result: null (no session files or auth.json found)");
      console.log("  Expected sources: ~/.codex/sessions/  OR  ~/.codex/auth.json");
    } else {
      console.log("Raw snapshot:", JSON.stringify(snapshot, null, 2));
      const status = rateLimitSnapshotToStatus(snapshot);
      console.log("Parsed status:", JSON.stringify(status, null, 2));
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

async function main(): Promise<void> {
  console.log("=".repeat(62));
  console.log("  @metyatech/ai-quota — Live Verification Script");
  console.log("  Date:", new Date().toISOString());
  console.log("=".repeat(62));

  await verifyClaude();
  await verifyGemini();
  await verifyCopilot();
  await verifyAmazonQ();
  await verifyCodex();

  console.log("\n" + "=".repeat(62));
  console.log("  Done. Review each result above manually.");
  console.log("=".repeat(62));
}

main().catch((err: unknown) => {
  console.error("Fatal:", err);
  process.exit(1);
});
