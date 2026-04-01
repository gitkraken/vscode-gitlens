# Testing Guide

How to run, debug, and interpret tests in the GitLens codebase. For test creation templates, use `/add-test`.

## Testing Structure

**Unit Tests**

- Tests co-located with source files in `__tests__/` directories
- Pattern: `src/path/to/__tests__/file.test.ts`
- VS Code extension tests use `@vscode/test-cli`
- Unit tests are built as part of the main build, but can be built directly: `pnpm run build:tests`

**End-to-End (E2E) Tests**

- E2E tests use Playwright in `tests/e2e/`
  - Fixture setup and utilities in `tests/e2e/fixtures/`
  - Page objects in `tests/e2e/pageObjects/`
  - Test specs in `tests/e2e/specs/`
- E2E tests are built as part of the main build, but can be built directly: `pnpm run bundle:e2e`

## Running Tests (for AI Assistants without VS Code API access)

If you don't have access to VS Code's built-in `runTests` tool (e.g., Claude Code, Augment, or terminal-based AI tools), use the following commands and patterns:

**Unit Tests**

```bash
# Run all unit tests
pnpm run test

# Run specific test file(s) - use glob patterns
pnpm run test -- --grep "pattern"

# Run tests in a specific directory
pnpm run test -- "src/git/__tests__/**/*.test.ts"
```

**E2E Tests (Playwright)**

```bash
# Run all E2E tests
pnpm run test:e2e

# Run specific test file
pnpm run test:e2e -- tests/e2e/specs/quickWizard.test.ts

# Run tests matching a pattern
pnpm run test:e2e -- --grep "wizard"

# Run in headed mode (useful for debugging)
pnpm run test:e2e -- --headed

# Run with specific project (Electron desktop)
pnpm run test:e2e -- --project=electron
```

## Interpreting Test Output

- PASS = test passed
- FAIL = test failed (look for error message and stack trace)
- Look for `Error:`, `AssertionError:`, or `expect(` lines for failure details
- E2E tests show screenshots on failure in `tests/e2e/test-results/`

## Before Running Tests

1. Ensure the extension is built: `pnpm run build` or have `pnpm run watch` running
2. For E2E tests, ensure `pnpm run bundle:e2e` has been run (or use watch mode)

## Debugging Test Failures

```bash
# Get verbose output
pnpm run test:e2e -- --reporter=list

# Run single test with full trace
pnpm run test:e2e -- --trace on --grep "test name"

# Check for TypeScript errors first
pnpm run lint
```

## AI Assistant Testing Guidelines

- **GitHub Copilot (VS Code)**: Has access to `runTests` and `testFailures` tools - use these for integrated test running and debugging
- **Claude Code / Augment / Terminal-based tools**: Use the terminal commands above
- Always run tests after making changes to verify correctness
- For E2E test failures, check `tests/e2e/test-results/` for screenshots and traces
- Parse test output looking for `FAIL`, `Error:`, `AssertionError:`, or failed `expect()` calls
- When debugging test failures, DON'T simplify NOR change the intent of the tests just to get them to pass. Instead, INVESTIGATE and UNDERSTAND the root cause of the failure and address that directly, or raise an issue to the user if you can't resolve it.
