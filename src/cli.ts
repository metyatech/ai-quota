#!/usr/bin/env node
/**
 * ai-quota CLI
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  fetchAllRateLimits,
  runMcpServer,
  SUPPORTED_AGENTS,
  AllRateLimits,
  SupportedAgent,
  agentToSdkKey
} from "./index.js";
import { formatResetIn, getVersion } from "./utils.js";

function padName(name: string): string {
  return (name + ":").padEnd(11);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(
      `ai-quota v${getVersion()}\n\n` +
        "Usage:\n" +
        "  ai-quota [agent]   Show quota for all agents, or a specific agent\n" +
        "  ai-quota --json    Output machine-readable JSON\n" +
        "  ai-quota --mcp     Start as an MCP server\n" +
        "  ai-quota --quiet   Suppress non-error output\n" +
        "  ai-quota --verbose Show extra debug info on stderr\n" +
        "  ai-quota --help    Show this help message\n" +
        "  ai-quota --version Show version\n"
    );
    return;
  }

  if (args.includes("--version") || args.includes("-V")) {
    process.stdout.write(`${getVersion()}\n`);
    return;
  }

  if (args.includes("--mcp")) {
    await runMcpServer();
    return;
  }

  const jsonMode = args.includes("--json");
  const quiet = args.includes("--quiet");
  const verbose = args.includes("--verbose");

  const requestedAgents = args.filter((a) => !a.startsWith("-")) as SupportedAgent[];

  const allResults = await fetchAllRateLimits({
    agents: requestedAgents.length > 0 ? requestedAgents : undefined,
    verbose,
    timeoutSeconds: 10
  });

  const agentsToDisplay = (
    requestedAgents.length > 0 ? requestedAgents : [...SUPPORTED_AGENTS]
  ) as SupportedAgent[];

  let anyError = false;
  const outputJson: Record<string, unknown> = {};

  for (const agent of agentsToDisplay) {
    const sdkKey = agentToSdkKey(agent);
    const res = allResults[sdkKey];
    if (!res) continue;

    if (res.status === "error") anyError = true;

    if (jsonMode) {
      outputJson[agent] = res.data || { error: res.error };
    } else if (!quiet) {
      process.stdout.write(`${padName(agent)} ${res.display}\n`);
    }
  }

  if (jsonMode && !quiet) {
    process.stdout.write(JSON.stringify(outputJson, null, 2) + "\n");
  }

  if (anyError) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(`ai-quota: fatal error: ${err}\n`);
  process.exitCode = 1;
});
