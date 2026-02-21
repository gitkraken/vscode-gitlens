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
import { test as base, expect, GitFixture, MaxTimeout } from '../baseTest.js';
import { createTmpDir } from '../fixtures/tmpDir.js';

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

	test('should display feature correctly', async ({ vscode, page, expect }) => {
		await vscode.gitlens.openGitLensSidebar();
		await expect(page.getByRole('heading')).toContainText('Expected');
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

1. Determine Git state needed (commits, branches, tags)
2. Create GitFixture setup
3. Cover: UI presence, user interactions, navigation, error states
4. Assertions: `expect(locator).toBeVisible()`, `.toContainText()`, `.toHaveCount()`

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
