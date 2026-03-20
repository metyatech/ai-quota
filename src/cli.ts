#!/usr/bin/env node
/**
 * ai-quota CLI
 */

import {
  fetchAllRateLimits,
  runMcpServer,
  SUPPORTED_AGENTS,
  type SupportedAgent,
  agentToSdkKey
} from "./index.js";
import { getVersion } from "./utils.js";
import { buildHumanRows, formatHumanTable } from "./human-output.js";
import { CliUsageError, parseCliRunOptions, shouldExitNonZero } from "./cli-core.js";

function showHelp(): void {
  process.stdout.write(
    `ai-quota v${getVersion()}\n\n` +
      "Usage:\n" +
      "  ai-quota [agent]           Show quota for all agents, or a specific agent\n" +
      "  ai-quota --json            Output machine-readable JSON\n" +
      "  ai-quota --mcp             Start as an MCP server\n" +
      "  ai-quota --quiet           Suppress non-error output\n" +
      "  ai-quota --strict          Exit non-zero if any provider fetch errors\n" +
      "  ai-quota --verbose         Show extra debug info on stderr\n" +
      "  ai-quota --help            Show this help message\n" +
      "  ai-quota --version         Show version\n\n" +
      "Agents: " +
      SUPPORTED_AGENTS.join(", ") +
      "\n" +
      "Output: table with AGENT, STATUS, LIMIT, DETAILS\n" +
      "Exit codes: default 0 when status report succeeds; use --strict for fetch-error exit.\n" +
      "Note: Use --json for scripts.\n"
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    showHelp();
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

  const { jsonMode, quiet, verbose, strict, requestedAgents } = parseCliRunOptions(
    args,
    SUPPORTED_AGENTS
  );

  const allResults = await fetchAllRateLimits({
    agents: requestedAgents.length > 0 ? requestedAgents : undefined,
    verbose,
    timeoutSeconds: 10
  });

  const agentsToDisplay = (
    requestedAgents.length > 0 ? requestedAgents : [...SUPPORTED_AGENTS]
  ) as SupportedAgent[];

  const outputJson: Record<string, unknown> = {};

  for (const agent of agentsToDisplay) {
    const sdkKey = agentToSdkKey(agent);
    const res = (allResults as any)[sdkKey];
    if (!res) continue;

    if (jsonMode) {
      outputJson[agent] = {
        status: res.status,
        reason: res.reason,
        error: res.error,
        data: res.data,
        display: res.display
      };
    }
  }

  if (!jsonMode && !quiet) {
    const rows = buildHumanRows(allResults, { agents: agentsToDisplay, now: new Date() });
    process.stdout.write(formatHumanTable(rows) + "\n");
  }

  if (jsonMode && !quiet) {
    process.stdout.write(JSON.stringify(outputJson, null, 2) + "\n");
  }

  if (shouldExitNonZero(allResults, strict)) process.exitCode = 1;
}

main().catch((err) => {
  if (err instanceof CliUsageError) {
    process.stderr.write(`ai-quota: ${err.message}\n`);
    process.stderr.write("Run 'ai-quota --help' for usage.\n");
    process.exitCode = 1;
    return;
  }

  process.stderr.write(`ai-quota: fatal error: ${err}\n`);
  process.exitCode = 1;
});
