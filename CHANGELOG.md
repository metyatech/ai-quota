# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.2] - 2026-02-19

### Changed

- Updated `tsconfig.build.json` to include the `scripts` directory in the build.
- Refactored `scripts/verify-live.ts` to use the new high-level SDK API.

## [0.4.1] - 2026-02-19

### Fixed

- Fixed incorrect import paths in unit tests and CLI following the SDK refactoring.
- Exported `formatResetIn` from the main entry point.

## [0.4.0] - 2026-02-19

### Added

- New high-level `fetchAllRateLimits` API in the SDK for easy integration.
- Unit tests for the aggregated API and display formatting.

### Changed

- Refactored the CLI to use the high-level SDK API, improving maintainability.
- Moved `getCopilotToken` and `formatResetIn` to accessible modules for better testability.

## [0.3.0] - 2026-02-19

### Added

- Support for detailed quota display in the CLI (multiple windows for Claude/Codex, model-specific usage for Gemini).

### Fixed

- Improved Copilot token retrieval by adding support for `gh auth token` command.
- Enhanced Codex session log parsing robustness for the latest rollout file format.

## [0.2.1] - 2026-02-19

### Fixed

- Replace process.exit() with process.exitCode to avoid libuv assertion crash on Windows with Node.js v24

## [0.1.0] - 2026-02-19

### Added

- Initial release.
- `fetchClaudeRateLimits` — fetches Claude quota from the Anthropic OAuth usage API.
- `fetchGeminiRateLimits` — fetches Gemini quota from the Cloud Code Assist API.
- `fetchCopilotRateLimits`, `parseCopilotUserInfo`, `parseCopilotQuotaHeader` — fetches Copilot quota from the GitHub internal API.
- `fetchAmazonQRateLimits`, `recordAmazonQUsage`, `loadAmazonQUsageState`, `saveAmazonQUsageState`, `resolveAmazonQUsageStatePath` — local counter-based quota tracking for Amazon Q Developer (no public API available).
- `fetchCodexRateLimits`, `rateLimitSnapshotToStatus` — fetches Codex (ChatGPT) rate limits from JSONL session files or the ChatGPT backend API.
- Shared types: `RateLimitWindow`, `RateLimitSnapshot`, `ClaudeUsageData`, `GeminiUsage`, `CopilotUsage`, `AmazonQUsageSnapshot`.
