import * as assert from 'assert';
import { truncatePromptWithDiff } from '../truncation.utils.js';

interface TestContext {
	diff?: string;
}

function getCharacters(ctx: TestContext): number {
	return ctx.diff?.length ?? 0;
}

suite('Truncation Utils Test Suite', () => {
	suite('truncatePromptWithDiff', () => {
		test('keeps high-priority source files over low-priority files', async () => {
			// Create a diff with a TypeScript file (high priority) and a lock file diff (low priority via scoring)
			const diff = `diff --git a/src/main.ts b/src/main.ts
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,2 +1,3 @@
 const x = 1;
+const y = 2;
 export { x };
diff --git a/generated.d.ts b/generated.d.ts
--- a/generated.d.ts
+++ b/generated.d.ts
@@ -1,100 +1,100 @@
${'+line\n'.repeat(100)}`;

			const context: TestContext = { diff: diff };

			// Set a budget that can fit only the smaller .ts file
			const result = await truncatePromptWithDiff(
				context as any,
				diff.length,
				300, // Small budget that should only fit the main.ts diff
				getCharacters as any,
			);

			assert.ok(result != null, 'Should return a truncated result');
			assert.ok(result.diff?.includes('src/main.ts'), 'Should keep the high-priority TypeScript file');
			assert.ok(!result.diff?.includes('generated.d.ts'), 'Should remove the low-priority .d.ts file');
		});

		test('returns undefined when no files can fit', async () => {
			const diff = `diff --git a/huge-file.ts b/huge-file.ts
--- a/huge-file.ts
+++ b/huge-file.ts
@@ -1,1000 +1,1000 @@
${'+line\n'.repeat(1000)}`;

			const context: TestContext = { diff: diff };

			const result = await truncatePromptWithDiff(
				context as any,
				diff.length,
				10, // Impossibly small budget
				getCharacters as any,
			);

			assert.strictEqual(result, undefined, 'Should return undefined when nothing fits');
		});

		test('returns unchanged context when everything fits', async () => {
			const diff = `diff --git a/small.ts b/small.ts
--- a/small.ts
+++ b/small.ts
@@ -1 +1 @@
-old
+new`;

			const context: TestContext = { diff: diff };

			const result = await truncatePromptWithDiff(
				context as any,
				diff.length,
				10000, // Large budget
				getCharacters as any,
			);

			assert.ok(result != null, 'Should return a result');
			assert.ok(result.diff?.includes('small.ts'), 'Should keep the file');
		});

		test('handles empty diff', async () => {
			const context: TestContext = { diff: '' };

			const result = await truncatePromptWithDiff(context as any, 0, 1000, getCharacters as any);

			assert.strictEqual(result, undefined, 'Should return undefined for empty diff');
		});

		test('handles undefined diff', async () => {
			const context: TestContext = { diff: undefined };

			const result = await truncatePromptWithDiff(context as any, 0, 1000, getCharacters as any);

			assert.strictEqual(result, undefined, 'Should return undefined for undefined diff');
		});

		test('prioritizes source code over documentation', async () => {
			const diff = `diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1,2 +1,3 @@
 # Title
+Some documentation
 Content
diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,2 +1,3 @@
 const app = {};
+app.init();
 export { app };`;

			const context: TestContext = { diff: diff };

			// Budget that fits only one file
			const result = await truncatePromptWithDiff(context as any, diff.length, 200, getCharacters as any);

			assert.ok(result != null, 'Should return a result');
			assert.ok(result.diff?.includes('src/app.ts'), 'Should keep the TypeScript file');
			assert.ok(!result.diff?.includes('README.md'), 'Should remove the markdown file');
		});

		test('deprioritizes test files compared to source files', async () => {
			const diff = `diff --git a/src/utils.test.ts b/src/utils.test.ts
--- a/src/utils.test.ts
+++ b/src/utils.test.ts
@@ -1,2 +1,3 @@
 test('example', () => {
+  expect(true).toBe(true);
 });
diff --git a/src/utils.ts b/src/utils.ts
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -1,2 +1,3 @@
 export function util() {
+  return 42;
 }`;

			const context: TestContext = { diff: diff };

			// Budget that fits only one file
			const result = await truncatePromptWithDiff(context as any, diff.length, 200, getCharacters as any);

			assert.ok(result != null, 'Should return a result');
			assert.ok(result.diff?.includes('src/utils.ts'), 'Should keep the source file');
			assert.ok(!result.diff?.includes('utils.test.ts'), 'Should remove the test file');
		});

		test('truncated result fits within target character limit', async () => {
			// Create a diff with multiple small files of varying sizes
			const files = [
				{ name: 'src/feature.ts', lines: 5 },
				{ name: 'src/utils.ts', lines: 4 },
				{ name: 'src/helper.ts', lines: 3 },
				{ name: 'tests/feature.test.ts', lines: 6 },
				{ name: 'docs/README.md', lines: 2 },
			];

			const diff = files
				.map(
					f => `diff --git a/${f.name} b/${f.name}
--- a/${f.name}
+++ b/${f.name}
@@ -1,${f.lines} +1,${f.lines} @@
${'+line\n'.repeat(f.lines)}`,
				)
				.join('');

			const context: TestContext = { diff: diff };
			// Set a limit that can fit some but not all files
			const targetLimit = 400;

			const result = await truncatePromptWithDiff(context as any, diff.length, targetLimit, getCharacters as any);

			assert.ok(result != null, 'Should return a truncated result');
			assert.ok(
				(result.diff?.length ?? 0) <= targetLimit,
				`Result length (${result.diff?.length}) should be <= target limit (${targetLimit})`,
			);
			// Should have removed at least one file
			assert.ok((result.diff?.length ?? 0) < diff.length, 'Result should be smaller than original diff');
		});

		test('multiple truncation levels find optimal fit', async () => {
			// Test that truncation finds the best fit, not just removes all files
			const smallFile = `diff --git a/small.ts b/small.ts
--- a/small.ts
+++ b/small.ts
@@ -1,5 +1,6 @@
 const a = 1;
+const b = 2;
 const c = 3;
 const d = 4;
 const e = 5;`;

			const largeFile = `diff --git a/large.ts b/large.ts
--- a/large.ts
+++ b/large.ts
@@ -1,100 +1,100 @@
${'+// large file line\n'.repeat(100)}`;

			const diff = `${smallFile}\n${largeFile}`;
			const context: TestContext = { diff: diff };

			// Budget that can fit the small file but not both
			const targetLimit = 300;

			const result = await truncatePromptWithDiff(context as any, diff.length, targetLimit, getCharacters as any);

			assert.ok(result != null, 'Should return a result');
			assert.ok(result.diff?.includes('small.ts'), 'Should include the small file');
			assert.ok(!result.diff?.includes('large.ts'), 'Should exclude the large file');
			assert.ok(
				(result.diff?.length ?? 0) <= targetLimit,
				`Result (${result.diff?.length} chars) should fit within limit (${targetLimit} chars)`,
			);
		});

		test('preserves file order by score when truncating', async () => {
			// Files with different priorities
			const diff = `diff --git a/src/core.ts b/src/core.ts
--- a/src/core.ts
+++ b/src/core.ts
@@ -1,3 +1,4 @@
 // core logic
+const x = 1;
 export {};
diff --git a/types.d.ts b/types.d.ts
--- a/types.d.ts
+++ b/types.d.ts
@@ -1,3 +1,4 @@
 // type definitions
+type X = number;
 export {};
diff --git a/src/utils.ts b/src/utils.ts
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -1,3 +1,4 @@
 // utilities
+const y = 2;
 export {};`;

			const context: TestContext = { diff: diff };

			// Budget that fits two files
			const targetLimit = 350;

			const result = await truncatePromptWithDiff(context as any, diff.length, targetLimit, getCharacters as any);

			assert.ok(result != null, 'Should return a result');
			// Should keep the .ts files (higher score) over .d.ts (lower score)
			assert.ok(result.diff?.includes('src/core.ts'), 'Should keep core.ts');
			assert.ok(result.diff?.includes('src/utils.ts'), 'Should keep utils.ts');
			assert.ok(!result.diff?.includes('types.d.ts'), 'Should remove types.d.ts (lower priority)');
		});
	});
});
