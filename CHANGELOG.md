# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.3] - 2026-02-19

### Added

- **MCP Unit Tests:** Added comprehensive unit tests for the MCP server and orchestration logic.

### Changed

- **Refactored MCP:** Extracted core logic into `handleMcpMessage` for better testability.
- **Improved MCP Output:** The `get_quota` tool now returns information in a clear Markdown table for better readability by AI agents.
- **Robust Error Handling:** Standardized JSON-RPC error responses in the MCP server.

## [0.5.2] - 2026-02-19

### Changed

- **AI Friendliness:** Enhanced the MCP `get_quota` tool to return results in a formatted Markdown table, making it easier for AI agents to present quota information to users.

### Fixed

- **Robust MCP:** Implemented standard JSON-RPC error handling and standardized response helper functions in the MCP server.

## [0.5.1] - 2026-02-19

### Added

- **MCP Documentation:** Added a setup guide for Claude Desktop in README.md.

### Fixed

- Improved type safety in the MCP server implementation by removing `any` casts.

## [0.5.5] - 2026-02-19

### Changed

- **Refactored Constants:** Moved the default Amazon Q monthly limit to the `amazon-q.ts` module to improve code decoupling and maintainability.

## [0.7.1] - 2026-02-20

### Fixed

- **Internal Type Safety:** Removed remaining `any` casts in the high-level SDK API and CLI implementation.
- **Shared Mapping:** Centralized agent name-to-SDK-key mapping into a reusable utility, ensuring consistency across all interfaces.

## [0.7.0] - 2026-02-19

### Added

- **Selective Fetching:** The `fetchAllRateLimits` API now supports an optional `agents` parameter, allowing users to fetch quota only for specific providers. This improves performance and reduces unnecessary API calls.

### Changed

- **Robust Orchestration:** Refactored the internal SDK logic to map results by agent name instead of array indices, making the codebase more resilient to future changes.
- **CLI/MCP Optimization:** Both the CLI and MCP server now leverage selective fetching when a single agent is requested.

## [0.6.1] - 2026-02-19

### Fixed

- **Final Codex Fix:** Resolved the persistent "no data" issue for Codex by correctly parsing `rate_limits` when it appears as a direct child of the event payload. Added a regression test with exact real-world log samples to prevent recurrence.

## [0.6.0] - 2026-02-19

### Changed

- **Architectural Improvements:** Centralized the list of supported AI agents into a single `SUPPORTED_AGENTS` constant in the SDK core. This ensures the CLI and MCP server are always in sync and makes it easier to add new providers in the future.

## [0.5.9] - 2026-02-19

### Fixed

- **Build Robustness:** Improved the shebang injection script with proper error handling and non-zero exit codes to ensure build integrity.

## [0.5.8] - 2026-02-19

### Changed

- **Refactored Utilities:** Centralized version resolution logic into a shared `utils.ts` module, removing code duplication between the CLI and MCP server.

## [0.5.7] - 2026-02-19

### Added

- **Complete API Documentation:** Finished adding detailed JSDoc comments to all individual agent fetchers (Claude, Gemini, Copilot, Amazon Q, and Codex), ensuring a premium developer experience in all supported environments.

## [0.5.6] - 2026-02-19

### Added

- **Public Utilities:** Formally exported `formatResetIn` utility for SDK users to maintain consistent time formatting in their own applications.

### Changed

- **SDK Cleanliness:** Reorganized and polished public exports in `src/index.ts` for a better developer experience.

## [0.5.4] - 2026-02-19

### Fixed

- **Metadata Sync:** Dynamically resolve the MCP server version from `package.json` to ensure consistency.
- **Code Style:** Unified code formatting across the entire project using Prettier.
- **Scripts:** Restored missing `format` scripts in `package.json`.

## [0.5.0] - 2026-02-19

### Added

- **MCP Server Support:** Introduced a Model Context Protocol (MCP) server mode (`ai-quota --mcp`). AI agents can now check their own quotas via the `get_quota` tool.
- **Full JSDoc Documentation:** Added detailed documentation to all public APIs and types, providing a better developer experience in IDEs.

## [0.4.7] - 2026-02-19

### Fixed

- Added regression tests for modern Codex session log formats found in the wild.

## [0.4.6] - 2026-02-19

### Fixed

- Restored support for the `AMAZON_Q_STATE_PATH` environment variable in the high-level SDK API.

## [0.4.5] - 2026-02-19

### Added

- New `npm run verify:live` script for easy developer-level verification via the CLI.

### Changed

- Simplified project structure: removed redundant `scripts/verify-live.ts` in favor of CLI verbose mode.
- Improved `.gitignore` to keep the repository clean of build artifacts and temp files.
- Internalized Amazon Q monthly limit constant.

## [0.4.4] - 2026-02-19

### Changed

- Refactored internal logic: moved shared time formatting to a private `utils.ts` module.
- Optimized npm package: resolved file duplication in `dist/` and reduced package size by half.
- Cleaned up public exports to keep the SDK API focused.

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
