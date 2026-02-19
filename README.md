# @metyatech/ai-quota

AI agent quota/rate-limit fetching library for Claude, Gemini, Copilot, Amazon Q, and Codex.

This package extracts the **quota fetching** layer from agent-runner so it can be reused
independently. Gate/ramp evaluation logic (e.g. `evaluateUsageGate`) is intentionally kept
out of this package — it remains in the calling application.

## Supported agents

| Agent     | Source                                      | API type              |
|-----------|---------------------------------------------|-----------------------|
| Claude    | `~/.claude/.credentials.json`               | REST (Anthropic OAuth)|
| Gemini    | `~/.gemini/oauth_creds.json`                | REST (Google OAuth)   |
| Copilot   | GitHub token (caller-provided)              | REST (GitHub API)     |
| Amazon Q  | Local JSON counter file                     | Local state (see note)|
| Codex     | JSONL session files / ChatGPT backend API   | Local files + REST    |

> **Amazon Q limitation:** Amazon Q Developer (free tier) does not provide a public API for
> querying usage or quota programmatically as of February 2026. There is no official AWS SDK
> method, REST endpoint, or CLI command that returns the number of agentic requests consumed
> against the monthly free-tier limit for Builder ID users. This library uses a local JSON
> counter file as the best available approach. Call `recordAmazonQUsage` after each Amazon Q
> invocation to keep the counter accurate.

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

| Option           | Type     | Default                    | Description                              |
|------------------|----------|----------------------------|------------------------------------------|
| `token`          | `string` | required                   | GitHub personal access token             |
| `timeoutSeconds` | `number` | `20`                       | Request timeout in seconds               |
| `apiBaseUrl`     | `string` | `https://api.github.com`   | Override GitHub API base URL             |
| `apiVersion`     | `string` | `2025-05-01`               | GitHub API version header                |

### Amazon Q

```typescript
import {
  fetchAmazonQRateLimits,
  recordAmazonQUsage,
  resolveAmazonQUsageStatePath
} from "@metyatech/ai-quota";

const statePath = resolveAmazonQUsageStatePath("/path/to/workdir");

// After each Amazon Q invocation:
recordAmazonQUsage(statePath);

// Check current quota:
const snapshot = fetchAmazonQRateLimits(statePath, 50 /* monthly limit */);
console.log("Used:", snapshot.used, "/", snapshot.limit);
console.log("Remaining:", snapshot.percentRemaining, "%");
```

### Codex

```typescript
import { fetchCodexRateLimits, rateLimitSnapshotToStatus } from "@metyatech/ai-quota";

const snapshot = await fetchCodexRateLimits({ codexHome: "~/.codex" });
if (snapshot) {
  const status = rateLimitSnapshotToStatus(snapshot);
  const weekly = status?.windows.find((w) => w.key === "weekly");
  console.log("Weekly % left:", weekly?.percentLeft);
}
```

Options for `fetchCodexRateLimits`:

| Option           | Type       | Default        | Description                              |
|------------------|------------|----------------|------------------------------------------|
| `codexHome`      | `string`   | `~/.codex`     | Path to the Codex home directory         |
| `timeoutSeconds` | `number`   | `20`           | HTTP API fallback timeout in seconds     |
| `timingSink`     | `function` | none           | Callback for per-phase timing (ms)       |

## Dev commands

```bash
npm install       # install dependencies
npm run build     # compile TypeScript to dist/
npm test          # run tests with vitest
npm run lint      # ESLint + tsc typecheck
npm run format    # Prettier format
npm run verify    # lint + test + build (full CI suite)
```

## Environment variables

| Variable                              | Used by | Purpose                                         |
|---------------------------------------|---------|-------------------------------------------------|
| `AGENT_RUNNER_GEMINI_OAUTH_CLIENT_ID` | Gemini  | Override OAuth client ID when Gemini CLI absent |
| `AGENT_RUNNER_GEMINI_OAUTH_CLIENT_SECRET` | Gemini | Override OAuth client secret                |

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
