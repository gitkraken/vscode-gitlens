---
name: add-test
description: Generate unit or E2E test files for existing code
---

# /add-test - Generate Tests

## Usage

```
/add-test [type] [target]
```

- `type` — `unit` (default) or `e2e`
- `target` — File path or feature name to test

## Unit Test Template

Creates `src/path/__tests__/file.test.ts`:

```typescript
import * as assert from 'assert';
import { functionToTest } from '../file.js';

suite('FeatureName Test Suite', () => {
	suite('functionName', () => {
		test('should handle normal input', () => {
			const result = functionToTest('input');
			assert.strictEqual(result, 'expected');
		});

		test('should handle edge case', () => {
			const result = functionToTest('');
			assert.strictEqual(result, undefined);
		});

		test('should throw on invalid input', () => {
			assert.throws(() => functionToTest(null), /error message/);
		});
	});

	suite('async function', () => {
		test('should resolve with data', async () => {
			const result = await asyncFunction();
			assert.deepStrictEqual(result, { key: 'value' });
		});
	});
});
```

When mocking is needed, use `sinon`:

```typescript
import * as sinon from 'sinon';

let sandbox: sinon.SinonSandbox;
setup(() => {
	sandbox = sinon.createSandbox();
});
teardown(() => {
	sandbox.restore();
});
```

## E2E Test Template

Creates `tests/e2e/specs/feature.test.ts`:

```typescript
import { test as base, createTmpDir, expect, GitFixture, MaxTimeout } from '../baseTest.js';

const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			setup: async () => {
				const repoDir = await createTmpDir();
				const git = new GitFixture(repoDir);
				await git.init();
				await git.commit('Initial commit', 'README.md', '# Test');
				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

test.describe('Feature Name', () => {
	test.describe.configure({ mode: 'serial' });

	test.afterEach(async ({ vscode }) => {
		await vscode.gitlens.resetUI();
	});

	test('should display feature correctly', async ({ vscode }) => {
		await vscode.gitlens.openGitLensSidebar();
		await expect(vscode.page.getByRole('heading')).toContainText('Expected');
	});
});
```

## Instructions

### Unit Tests

1. Read target file to understand exports
2. Create `__tests__/` directory if needed
3. Cover: normal paths, edge cases (empty/null/undefined), error conditions, async operations
4. Assertions: `assert.strictEqual()`, `assert.deepStrictEqual()`, `assert.ok()`, `assert.throws()`

### E2E Tests

**Use the MCP server to explore, then write the test.** Don't guess at selectors — verify them live.

1. **Explore with MCP first** — Use `/inspect-live` to launch VS Code and discover the right selectors:
   ```
   launch {}
   execute_command { command: "gitlens.showHomeView" }
   aria_snapshot {}                              # See all UI elements and roles
   inspect_dom { selector: "h1", in_webview: true }  # Find webview content
   screenshot {}                                 # Visual verification
   ```
2. **Determine Git state needed** — what commits, branches, tags does the test need?
3. **Create GitFixture setup** — use the methods below
4. **Write the test** using selectors discovered via MCP
5. **Validate with MCP** — run the test scenario manually through MCP tools to confirm assertions before finalizing:
   - Use `inspect_dom` to verify element text/visibility
   - Use `evaluate` to check extension runtime state
   - Use `screenshot` to visually confirm UI state
6. Cover: UI presence, user interactions, navigation, error states, Pro vs Community gating
7. Assertions: `expect(locator).toBeVisible()`, `.toContainText()`, `.toHaveCount()`

### E2E Webview Content

Use `getGitLensWebview(title, purpose)` to get a `FrameLocator` for webview content:

```typescript
const webview = await vscode.gitlens.getGitLensWebview('Home', 'webviewView');
await expect(webview!.locator('h1')).toContainText('Expected heading');
await expect(webview!.getByRole('button', { name: /Try Pro/i })).toBeVisible();
```

Available webviews: `Home`, `Graph`, `Graph Details`, `Inspect`, `Visual File History`, `Interactive Rebase`.
Purpose is `webviewView` (sidebar/panel) or `webviewPanel` (editor tab) or `customEditor`.

### E2E Pro Feature Gating

```typescript
// Simulate Pro subscription for the test
using _ = await vscode.gitlens.startSubscriptionSimulation({
	state: 6 /* SubscriptionState.Paid */,
	planId: 'pro',
});
// Pro features now accessible — auto-reverts when scope exits
```

## GitFixture Methods

```typescript
await git.init()
await git.commit(message, fileName, content)
await git.branch(name)
await git.checkout(name, create?)
await git.tag(name, { message?, ref? })
await git.stash(message?)
await git.worktree(path, branch)
await git.addRemote(name, url)
await git.merge(branch, message?)
```

## Running Tests

```bash
pnpm run test -- --grep "FeatureName"           # Unit
pnpm run test:e2e -- tests/e2e/specs/file.test.ts  # E2E
```

For detailed test running patterns, output interpretation, and debugging: see `docs/testing.md`.
