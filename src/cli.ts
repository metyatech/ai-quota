#!/usr/bin/env node
/**
 * ai-quota CLI
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { fetchAllRateLimits } from "./index.js";

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

  const jsonMode = args.includes("--json");
  const quiet = args.includes("--quiet");
  const verbose = args.includes("--verbose");

  const requestedAgents = args.filter(a => !a.startsWith("-"));
  
  const allResults = await fetchAllRateLimits({ verbose, timeoutSeconds: 10 });
  
  const agentsToDisplay = (requestedAgents.length > 0 
    ? requestedAgents 
    : ["claude", "gemini", "copilot", "amazon-q", "codex"]) as (keyof typeof allResults)[];

  let anyError = false;
  const outputJson: any = {};

  for (const key of agentsToDisplay) {
    const res = allResults[key === ("amazon-q" as any) ? "amazonQ" : key];
    if (!res) continue;

    if (res.status === "error") anyError = true;
    
    if (jsonMode) {
      outputJson[key] = res.data || { error: res.error };
    } else if (!quiet) {
      process.stdout.write(`${padName(key)} ${res.display}\n`);
    }
  }

  if (jsonMode && !quiet) {
    process.stdout.write(JSON.stringify(outputJson, null, 2) + "\n");
  }

  if (anyError) process.exitCode = 1;
}

main().catch(err => {
  process.stderr.write(`ai-quota: fatal error: ${err}\n`);
  process.exitCode = 1;
});
