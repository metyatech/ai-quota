# Contributing

Thank you for your interest in contributing to `@metyatech/ai-quota`.

## Development setup

```bash
git clone https://github.com/metyatech/ai-quota.git
cd ai-quota
npm install
npm run verify   # lint + test + build
```

## Submitting changes

1. Fork the repository and create a feature branch.
2. Add or update tests for any changed behavior.
3. Run `npm run verify` and ensure all checks pass.
4. Open a pull request with a clear description of the change.

## Code style

- TypeScript strict mode is required.
- Format with Prettier (`npm run format`).
- Lint with ESLint (`npm run lint`).
- All exports must have JSDoc comments.

## Scope

This package covers **quota fetching only**. Gate/ramp evaluation logic belongs in the calling application. Please keep PRs scoped to fetching-layer concerns.
