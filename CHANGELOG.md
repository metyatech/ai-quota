# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-02-19

### Added

- Initial release.
- `fetchClaudeRateLimits` — fetches Claude quota from the Anthropic OAuth usage API.
- `fetchGeminiRateLimits` — fetches Gemini quota from the Cloud Code Assist API.
- `fetchCopilotRateLimits`, `parseCopilotUserInfo`, `parseCopilotQuotaHeader` — fetches Copilot quota from the GitHub internal API.
- `fetchAmazonQRateLimits`, `recordAmazonQUsage`, `loadAmazonQUsageState`, `saveAmazonQUsageState`, `resolveAmazonQUsageStatePath` — local counter-based quota tracking for Amazon Q Developer (no public API available).
- `fetchCodexRateLimits`, `rateLimitSnapshotToStatus` — fetches Codex (ChatGPT) rate limits from JSONL session files or the ChatGPT backend API.
- Shared types: `RateLimitWindow`, `RateLimitSnapshot`, `ClaudeUsageData`, `GeminiUsage`, `CopilotUsage`, `AmazonQUsageSnapshot`.
