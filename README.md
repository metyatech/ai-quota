# @metyatech/ai-quota

AI agent quota/rate-limit fetching library for Claude, Gemini, Copilot, and Codex.

This package extracts the **quota fetching** layer from agent-runner so it can be reused
independently. Gate/ramp evaluation logic (e.g. `evaluateUsageGate`) is intentionally kept
out of this package — it remains in the calling application.

## CLI

After installing the package globally or via `npx`, run `ai-quota` to check quota for all agents at once.

```bash
# Install globally
npm install -g @metyatech/ai-quota

# Or use with npx (no install required)
npx @metyatech/ai-quota
```

### Commands

```
ai-quota [agent]           Show quota for all agents, or a single named agent
ai-quota --json            Machine-readable JSON output
ai-quota --mcp             Start as an MCP server
ai-quota --quiet           Suppress non-error output (useful in scripts)
ai-quota --strict          Exit non-zero if any provider fetch returns error
ai-quota --verbose         Print debug info to stderr
ai-quota --help            Show usage information
ai-quota --version         Show version
```

Supported agent names: `claude`, `gemini`, `copilot`, `codex`

### Usage Examples

**Check all quotas:**

```bash
ai-quota
```

## Model Context Protocol (MCP)

`ai-quota` can act as an MCP server, allowing AI agents (like Claude Desktop) to check your
remaining quota automatically.

### Setup for Claude Desktop

Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ai-quota": {
      "command": "npx",
      "args": ["-y", "@metyatech/ai-quota", "--mcp"]
    }
  }
}
```

This exposes the `get_quota` tool to Claude, which it can use to stay aware of its own usage
limits across different models and providers.

### MCP Resources

`ai-quota` also provides an MCP resource:

- **URI:** `quota://current`
- **Description:** A live, auto-updating Markdown table of all current AI agent quotas.

AI agents can "subscribe" to this resource to keep the quota information in their context
without needing to explicitly call a tool.

**Tool: `get_quota`**

- `agent` (optional): Specific agent to check (`claude`, `gemini`, etc.). If omitted, returns quota for all agents in a Markdown table.

### Human-readable output example

```
AGENT        STATUS     LIMIT  DETAILS
-----------  ---------  -----  ---------------------------------------------------------------
claude       CAN_USE    5h     5h: 8% used (reset in 1h 39m), 7d: 22% used (reset in 5d 20h 39m) (all models), 7d: 15% used (reset in 5d 2h 39m) (sonnet only)
gemini/pro   CAN_USE    pro    4% used (reset in 14h 14m)
gemini/flash CAN_USE    flash  40% used (reset in 14h 18m)
copilot      LOW_QUOTA  -      72% used (reset in 9d 11h)
codex        CAN_USE    5h     5h: 65% used (reset in 3h), 7d: 21% used (reset in 6d)
```

### JSON output example

```bash
ai-quota --json
```

```json
{
  "claude": { "status": "ok", "reason": null, "error": null, "data": { ... }, "display": "5h: 8% used (...)" },
  "gemini": { "status": "ok", "reason": null, "error": null, "data": { ... }, "display": "pro: 4% used (...)" },
  "copilot": { "status": "ok", "reason": null, "error": null, "data": { ... }, "display": "72% used (...)" },
  "codex": { "status": "ok", "reason": null, "error": null, "data": { ... }, "display": "5h: 65% used (...)" }
}
```

### Credential lookup

| Agent   | Source                                                                                                                     |
| ------- | -------------------------------------------------------------------------------------------------------------------------- |
| Claude  | `~/.claude/.credentials.json`                                                                                              |
| Gemini  | `~/.gemini/oauth_creds.json`                                                                                               |
| Copilot | `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`, Copilot CLI stored OAuth token, `gh auth token`, or legacy `hosts.yml` |
| Codex   | `~/.codex/auth.json`                                                                                                       |

Claude token behavior: `ai-quota` automatically refreshes Claude OAuth tokens using `refreshToken` when needed (including stale-token `401/403/429` retries).
Copilot token behavior: if you already authenticated with `copilot login`, `ai-quota` will reuse that stored OAuth token automatically, including Windows Credential Manager entries created by Copilot CLI.

Exit code is `0` when the command successfully reports status output (table or JSON), even if some providers are unavailable/login-required/waiting for reset.
Use `--strict` to make provider fetch errors fail with exit code `1`.
Invalid usage (unknown option/agent) and fatal command failures also exit with `1`.

### Advanced usage (SDK)

To fetch quota for all agents at once:

```typescript
import { fetchAllRateLimits } from "@metyatech/ai-quota";

const all = await fetchAllRateLimits();
console.log("Overall status:", all.summary.status); // "healthy", "warning", or "critical"
console.log("Summary message:", all.summary.message);
console.log("Claude status:", all.claude.display);
```

To fetch only specific agents (more efficient):

```typescript
import { fetchAllRateLimits } from "@metyatech/ai-quota";

// Only fetch Claude and Copilot
const results = await fetchAllRateLimits({
  agents: ["claude", "copilot"]
});

console.log(results.claude.display);
console.log(results.copilot.display);
console.log(results.gemini.display); // "skipped"
```

## Supported agents

| Agent   | Source                         | API type                |
| ------- | ------------------------------ | ----------------------- |
| Claude  | `~/.claude/.credentials.json`  | REST (Anthropic OAuth)  |
| Gemini  | `~/.gemini/oauth_creds.json`   | REST (Google OAuth)     |
| Copilot | GitHub token (caller-provided) | REST (GitHub API)       |
| Codex   | `~/.codex/auth.json`           | REST (ChatGPT internal) |

## Requirements

- Node.js >= 18
- TypeScript (peer — types are included in the package)

## Installation

```bash
npm install @metyatech/ai-quota
```

## Usage

### Claude

```typescript
import { fetchClaudeRateLimits } from "@metyatech/ai-quota";

const usage = await fetchClaudeRateLimits();
if (usage) {
  console.log("5h utilization:", usage.five_hour?.utilization);
  console.log("7-day utilization:", usage.seven_day?.utilization);
}
```

### Gemini

```typescript
import { fetchGeminiRateLimits } from "@metyatech/ai-quota";

const usage = await fetchGeminiRateLimits();
if (usage) {
  const pro = usage["gemini-3-pro-preview"];
  console.log("Pro used %:", pro?.usage, "/ limit:", pro?.limit);
}
```

Set `AGENT_RUNNER_GEMINI_OAUTH_CLIENT_ID` and `AGENT_RUNNER_GEMINI_OAUTH_CLIENT_SECRET` when
the Gemini CLI is not installed, or extract them from the Gemini CLI source.

### Copilot

```typescript
import { fetchCopilotRateLimits } from "@metyatech/ai-quota";

const usage = await fetchCopilotRateLimits({ token: process.env.GITHUB_TOKEN! });
if (usage) {
  console.log("Percent remaining:", usage.percentRemaining);
  console.log("Resets at:", usage.resetAt);
}
```

Options:

| Option           | Type     | Default                  | Description                  |
| ---------------- | -------- | ------------------------ | ---------------------------- |
| `token`          | `string` | required                 | GitHub personal access token |
| `timeoutSeconds` | `number` | `20`                     | Request timeout in seconds   |
| `apiBaseUrl`     | `string` | `https://api.github.com` | Override GitHub API base URL |
| `apiVersion`     | `string` | `2025-05-01`             | GitHub API version header    |

### Codex

```typescript
import { fetchCodexRateLimits, rateLimitSnapshotToStatus } from "@metyatech/ai-quota";

const snapshot = await fetchCodexRateLimits({ codexHome: "~/.codex" });
const status = rateLimitSnapshotToStatus(snapshot);
const weekly = status?.windows.find((w) => w.key === "weekly");
console.log("Weekly % left:", weekly?.percentLeft);
```

Options for `fetchCodexRateLimits`:

| Option           | Type       | Default    | Description                         |
| ---------------- | ---------- | ---------- | ----------------------------------- |
| `codexHome`      | `string`   | `~/.codex` | Path to the Codex home directory    |
| `timeoutSeconds` | `number`   | `20`       | HTTP API request timeout in seconds |
| `timingSink`     | `function` | none       | Callback for per-phase timing (ms)  |

## Dev commands

```bash
npm install       # install dependencies
npm run build     # compile TypeScript to dist/
npm test          # run tests with vitest
npm run lint      # ESLint + tsc typecheck
npm run format    # Prettier format
npm run verify    # lint + test + build (full CI suite)
```

## Release and publish

`ai-quota` publishes to npm from GitHub Actions via npm trusted publishing (OIDC). The
release workflow lives in `.github/workflows/publish.yml`, runs when a GitHub release is
published, and uses Node.js 24 because npm trusted publishing requires a modern npm/Node
runtime in CI.

Release flow:

```bash
npm version patch --no-git-tag-version
# update CHANGELOG.md as needed
npm run verify
git add package.json package-lock.json CHANGELOG.md
git commit -m "Release vX.Y.Z"
git push origin main
git tag vX.Y.Z
git push origin vX.Y.Z
```

Then publish a GitHub release for the `vX.Y.Z` tag. GitHub Actions will run the publish
workflow, publish the package to npm, and attach npm provenance automatically when trusted
publishing is configured for the package.

## Environment variables

| Variable                                  | Used by | Purpose                                         |
| ----------------------------------------- | ------- | ----------------------------------------------- |
| `AGENT_RUNNER_GEMINI_OAUTH_CLIENT_ID`     | Gemini  | Override OAuth client ID when Gemini CLI absent |
| `AGENT_RUNNER_GEMINI_OAUTH_CLIENT_SECRET` | Gemini  | Override OAuth client secret                    |

## SemVer policy

Breaking changes (removed/renamed exports, changed function signatures) bump the major version.
New exports and backward-compatible changes bump the minor version.
Bug fixes bump the patch version.

## Links

- [CHANGELOG.md](./CHANGELOG.md)
- [SECURITY.md](./SECURITY.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [LICENSE](./LICENSE)
