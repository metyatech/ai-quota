import type { AllRateLimits, SupportedAgent } from "./index.js";

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export type CliRunOptions = {
  jsonMode: boolean;
  quiet: boolean;
  verbose: boolean;
  strict: boolean;
  requestedAgents: SupportedAgent[];
};

const RUNTIME_FLAGS = new Set(["--json", "--quiet", "--verbose", "--strict"]);

export function parseCliRunOptions(
  args: string[],
  supportedAgents: readonly SupportedAgent[]
): CliRunOptions {
  const supportedSet = new Set<string>(supportedAgents);
  const requestedAgents: SupportedAgent[] = [];

  for (const arg of args) {
    if (arg.startsWith("-")) {
      if (!RUNTIME_FLAGS.has(arg)) {
        throw new CliUsageError(`unknown option: ${arg}`);
      }
      continue;
    }

    if (!supportedSet.has(arg)) {
      throw new CliUsageError(`unknown agent: ${arg}`);
    }
    requestedAgents.push(arg as SupportedAgent);
  }

  return {
    jsonMode: args.includes("--json"),
    quiet: args.includes("--quiet"),
    verbose: args.includes("--verbose"),
    strict: args.includes("--strict"),
    requestedAgents
  };
}

export function shouldExitNonZero(result: AllRateLimits, strict: boolean): boolean {
  if (!strict) return false;

  return (
    result.claude.status === "error" ||
    result.gemini.status === "error" ||
    result.copilot.status === "error" ||
    result.codex.status === "error"
  );
}
