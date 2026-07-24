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
```

To pass any Playwright **option** (`--grep`, `--headed`, `--project`, `--workers`, …), invoke Playwright
directly via `pnpm exec` rather than `pnpm run test:e2e -- <option>`: pnpm forwards the literal `--` to
Playwright, which then treats everything after it as positional (file) filters, so the option is silently
ignored (this is why CI calls `pnpm exec playwright` too).

```bash
# Run a specific test file
pnpm exec playwright test -c tests/e2e/playwright.config.ts tests/e2e/specs/quickWizard.test.ts

# Run tests matching a pattern
pnpm exec playwright test -c tests/e2e/playwright.config.ts --grep "wizard"

# Run in headed mode (useful for debugging)
pnpm exec playwright test -c tests/e2e/playwright.config.ts --headed

# Run against a specific editor (one Playwright project per editor; see tests/e2e/editors.ts).
# VS Code is the default; a fork project only registers when its binary path env var is set.
pnpm exec playwright test -c tests/e2e/playwright.config.ts --project=vscode
WINDSURF_E2E_PATH=/path/to/windsurf pnpm exec playwright test -c tests/e2e/playwright.config.ts --project=windsurf
```

Editors that lack the UI surface a given spec needs (e.g. some forks) can opt that spec out with the
`@no-fork` tag — fork projects run with `grepInvert: /@no-fork/`, while `vscode` runs everything:

```ts
// @no-fork: <editor> lacks a stable point to drive this flow
test('...', { tag: '@no-fork' }, async ({ vscode }) => {
	/* ... */
});
```

Only tag genuine editor incompatibilities (missing UI), never functional failures — those get fixed.

### Login-walled forks (Cursor, Kiro)

Some forks hard-gate their entire workbench behind a sign-in wall on a fresh (unauthenticated) profile —
the state every CI run and every harness-created temp profile is in:

- **Cursor** shows a full-screen `.onboarding-v2-overlay` ("Sign Up / Log In", "Cursor's AI features
  require you to be logged in") with no "continue without an account" affordance, leaving the workbench in
  `nomaineditorarea nosidebar` so every pointer event is swallowed.
- **Kiro** shows a full-screen `kiro-sign-in-page` overlay — a "Sign in" page ("By signing in, you agree
  to the AWS Customer Agreement, Service Terms, and Privacy Notice") whose only action is AWS Builder ID
  sign-in. There is no skip / continue-without-account affordance (verified by dumping the overlay's DOM
  on a fresh profile — it reproduces both locally and in CI; a fresh profile is never authenticated, so
  specs fail everywhere, not just in CI).

Neither can be bypassed without a real auth token (which CI can't carry), and seeding the non-auth
onboarding flags into `state.vscdb` does not lift them.

The harness detects the wall in `baseTest.ts` (`assertWorkbenchReachable`) and fails the worker fixture
fast with a clear message, instead of letting each UI-driven spec burn its full click timeout. But
fail-fast alone does not bound the job: a failed worker fixture can't be reused, so Playwright relaunches
the editor for the _next_ test into the same wall, and `retries` multiplies that — the job still burns its
wall-clock and gets cancelled with zero useful signal. So login-walled forks are **excluded from the CI matrix** entirely via `editors.ts`
`runInCI: false` (the single source of truth the CI matrix derives from). They stay `experimental` and
registered for local `--project=<id>` runs on an authenticated machine — and only there does anything
exercise. Note the wall gates _every_ spec, not just the UI-driven ones: the `mcp*` specs depend on the
same worker-scoped `vscode` fixture (via `mcpClient`), so `assertWorkbenchReachable` throwing fails them
too. On a login-walled fork nothing runs — UI or `mcp*` — until the fork is authenticated.

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
pnpm run check
```

## AI Assistant Testing Guidelines

- **GitHub Copilot (VS Code)**: Has access to `runTests` and `testFailures` tools - use these for integrated test running and debugging
- **Claude Code / Augment / Terminal-based tools**: Use the terminal commands above
- Always run tests after making changes to verify correctness
- For E2E test failures, check `tests/e2e/test-results/` for screenshots and traces
- Parse test output looking for `FAIL`, `Error:`, `AssertionError:`, or failed `expect()` calls
- When debugging test failures, DON'T simplify NOR change the intent of the tests just to get them to pass. Instead, INVESTIGATE and UNDERSTAND the root cause of the failure and address that directly, or raise an issue to the user if you can't resolve it.
