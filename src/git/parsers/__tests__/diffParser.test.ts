import * as assert from 'assert';
import { countDiffInsertionsAndDeletions, countDiffLines, filterDiffFiles, parseGitDiff } from '../diffParser.js';

suite('Diff Parser Test Suite', () => {
	test('parses renamed file without changes', () => {
		const diffContent = `a/old-file.ts b/new-file.ts
similarity index 100%
rename from old-file.ts
rename to new-file.ts`;

		const result = parseGitDiff(diffContent);

		assert.strictEqual(result.files.length, 1, 'Should parse one file');

		const file = result.files[0];
		assert.strictEqual(file.path, 'new-file.ts', 'Should have correct new path');
		assert.strictEqual(file.originalPath, 'old-file.ts', 'Should have correct original path');
		assert.strictEqual(file.status, 'R', 'Should have rename status');
		assert.strictEqual(file.hunks.length, 0, 'Should have no hunks for pure rename');
	});

	test('parses new file', () => {
		const diffContent = `a/dev/null b/new-file.ts
new file mode 100644
index 0000000..abc123
--- /dev/null
+++ b/new-file.ts`;

		const result = parseGitDiff(diffContent);

		assert.strictEqual(result.files.length, 1, 'Should parse one file');

		const file = result.files[0];
		assert.strictEqual(file.path, 'new-file.ts', 'Should have correct path');
		assert.strictEqual(file.originalPath, 'dev/null', 'Should have no original path');
		assert.strictEqual(file.status, 'A', 'Should have added status');
		assert.strictEqual(file.hunks.length, 0, 'Should have no hunks without @@ markers');
	});

	test('parses deleted file', () => {
		const diffContent = `a/old-file.ts b/dev/null
deleted file mode 100644
index abc123..0000000
--- a/old-file.ts
+++ /dev/null`;

		const result = parseGitDiff(diffContent);

		assert.strictEqual(result.files.length, 1, 'Should parse one file');

		const file = result.files[0];
		assert.strictEqual(file.path, 'dev/null', 'Should have correct path');
		assert.strictEqual(file.originalPath, 'old-file.ts', 'Should have correct original path');
		assert.strictEqual(file.status, 'D', 'Should have deleted status');
		assert.strictEqual(file.hunks.length, 0, 'Should have no hunks without @@ markers');
	});

	test('parses mode change without content change', () => {
		const diffContent = `a/script.sh b/script.sh
old mode 100644
new mode 100755`;

		const result = parseGitDiff(diffContent);

		assert.strictEqual(result.files.length, 1, 'Should parse one file');

		const file = result.files[0];
		assert.strictEqual(file.path, 'script.sh', 'Should have correct path');
		assert.strictEqual(file.originalPath, undefined, 'Should have no original path');
		assert.strictEqual(file.status, 'T', 'Should have type change status');
		assert.strictEqual(file.hunks.length, 0, 'Should have no hunks for mode change only');
	});

	test('parses binary file change', () => {
		const diffContent = `a/image.png b/image.png
index abc123..def456 100644
Binary files a/image.png and b/image.png differ`;

		const result = parseGitDiff(diffContent);

		assert.strictEqual(result.files.length, 1, 'Should parse one file');

		const file = result.files[0];
		assert.strictEqual(file.path, 'image.png', 'Should have correct path');
		assert.strictEqual(file.originalPath, undefined, 'Should have no original path');
		assert.strictEqual(file.status, 'M', 'Should have modified status for binary file');
		assert.strictEqual(file.hunks.length, 0, 'Should have no hunks for binary file');
	});

	test('parses regular file with content changes', () => {
		const diffContent = `a/file.ts b/file.ts
index abc123..def456 100644
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
 line 1
+new line
 line 2
 line 3`;

		const result = parseGitDiff(diffContent);

		assert.strictEqual(result.files.length, 1, 'Should parse one file');

		const file = result.files[0];
		assert.strictEqual(file.path, 'file.ts', 'Should have correct path');
		assert.strictEqual(file.originalPath, undefined, 'Should have no original path');
		assert.strictEqual(file.status, 'M', 'Should have modified status');
		assert.strictEqual(file.hunks.length, 1, 'Should have one hunk');
	});

	test('parses multiple files with mixed types', () => {
		const diffContent = `a/old-file.ts b/new-file.ts
similarity index 100%
rename from old-file.ts
rename to new-file.ts
diff --git a/regular-file.ts b/regular-file.ts
index abc123..def456 100644
--- a/regular-file.ts
+++ b/regular-file.ts
@@ -1,2 +1,3 @@
 line 1
+new line
 line 2`;

		const result = parseGitDiff(diffContent);

		assert.strictEqual(result.files.length, 2, 'Should parse two files');

		// First file (rename)
		const renameFile = result.files[0];
		assert.strictEqual(renameFile.path, 'new-file.ts', 'Should have correct new path');
		assert.strictEqual(renameFile.originalPath, 'old-file.ts', 'Should have correct original path');
		assert.strictEqual(renameFile.status, 'R', 'Should have rename status');
		assert.strictEqual(renameFile.hunks.length, 0, 'Should have no hunks for pure rename');

		// Second file (regular change)
		const modifiedFile = result.files[1];
		assert.strictEqual(modifiedFile.path, 'regular-file.ts', 'Should have correct path');
		assert.strictEqual(modifiedFile.originalPath, undefined, 'Should have no original path');
		assert.strictEqual(modifiedFile.status, 'M', 'Should have modified status');
		assert.strictEqual(modifiedFile.hunks.length, 1, 'Should have one hunk');
	});
});

suite('filterDiffFiles Test Suite', () => {
	const multiFileDiff = `diff --git a/src/main.ts b/src/main.ts
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,2 +1,3 @@
 const x = 1;
+const y = 2;
 export { x };
diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,100 +1,100 @@
-old lock content
+new lock content
diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1,2 @@
 # Title
+Some content`;

	test('filters files based on predicate returning included paths', async () => {
		const result = await filterDiffFiles(multiFileDiff, paths => {
			// Only include .ts files
			return paths.filter(p => p.endsWith('.ts'));
		});

		assert.ok(result.includes('src/main.ts'), 'Should include the .ts file');
		assert.ok(!result.includes('package-lock.json'), 'Should exclude lock file');
		assert.ok(!result.includes('README.md'), 'Should exclude markdown file');
	});

	test('returns original diff when all files are included', async () => {
		const result = await filterDiffFiles(multiFileDiff, paths => paths);

		assert.strictEqual(result, multiFileDiff, 'Should return original diff unchanged');
	});

	test('returns empty string when all files are excluded', async () => {
		const result = await filterDiffFiles(multiFileDiff, () => []);

		assert.strictEqual(result, '', 'Should return empty string');
	});

	test('preserves original diff bytes exactly', async () => {
		const result = await filterDiffFiles(multiFileDiff, paths => paths.filter(p => p.endsWith('.ts')));

		// The result should be exactly the first file chunk from the original
		const expectedChunk = `diff --git a/src/main.ts b/src/main.ts
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,2 +1,3 @@
 const x = 1;
+const y = 2;
 export { x };
`;
		assert.strictEqual(result, expectedChunk, 'Should preserve exact bytes from original');
	});

	test('handles empty diff', async () => {
		const result = await filterDiffFiles('', () => []);

		assert.strictEqual(result, '', 'Should return empty string for empty input');
	});

	test('handles async predicate', async () => {
		const result = await filterDiffFiles(multiFileDiff, async paths => {
			// Simulate async operation
			await Promise.resolve();
			return paths.filter(p => p.endsWith('.md'));
		});

		assert.ok(result.includes('README.md'), 'Should include the markdown file');
		assert.ok(!result.includes('src/main.ts'), 'Should exclude the .ts file');
	});

	test('handles diff with spaces in filenames', async () => {
		const diffWithSpaces = `diff --git a/path with spaces/file.ts b/path with spaces/file.ts
--- a/path with spaces/file.ts
+++ b/path with spaces/file.ts
@@ -1 +1,2 @@
 line 1
+line 2`;

		const result = await filterDiffFiles(diffWithSpaces, paths => paths);

		assert.ok(result.includes('path with spaces/file.ts'), 'Should handle spaces in paths');
	});
});

suite('countDiffLines Test Suite', () => {
	test('counts lines in a simple hunk', () => {
		const diff = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
 line 1
+new line
 line 2
 line 3`;

		const parsed = parseGitDiff(diff);
		assert.strictEqual(parsed.files.length, 1);

		const count = countDiffLines(parsed.files[0]);
		// previous: 3 lines, current: 4 lines
		assert.strictEqual(count, 7, 'Should count lines from both sides');
	});

	test('returns 0 for file without hunks', () => {
		const diff = `diff --git a/old.ts b/new.ts
similarity index 100%
rename from old.ts
rename to new.ts`;

		const parsed = parseGitDiff(diff);
		assert.strictEqual(parsed.files.length, 1);

		const count = countDiffLines(parsed.files[0]);
		assert.strictEqual(count, 0, 'Should return 0 for rename without content');
	});

	test('counts lines across multiple hunks', () => {
		const diff = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,2 +1,3 @@
 line 1
+new line 1
 line 2
@@ -10,2 +11,3 @@
 line 10
+new line 2
 line 11`;

		const parsed = parseGitDiff(diff);
		assert.strictEqual(parsed.files.length, 1);

		const count = countDiffLines(parsed.files[0]);
		// First hunk: prev 2 + curr 3 = 5
		// Second hunk: prev 2 + curr 3 = 5
		// Total = 10
		assert.strictEqual(count, 10, 'Should sum lines from all hunks');
	});
});

suite('countDiffInsertionsAndDeletions Test Suite', () => {
	test('counts insertions and deletions separately', () => {
		const diff = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
 line 1
+new line
 line 2
 line 3`;

		const parsed = parseGitDiff(diff);
		assert.strictEqual(parsed.files.length, 1);

		const { insertions, deletions } = countDiffInsertionsAndDeletions(parsed.files[0]);
		// previous: 3 lines (deletions context), current: 4 lines (insertions context)
		assert.strictEqual(insertions, 4, 'Should count current lines as insertions');
		assert.strictEqual(deletions, 3, 'Should count previous lines as deletions');
	});

	test('returns zeros for file without hunks', () => {
		const diff = `diff --git a/old.ts b/new.ts
similarity index 100%
rename from old.ts
rename to new.ts`;

		const parsed = parseGitDiff(diff);
		assert.strictEqual(parsed.files.length, 1);

		const { insertions, deletions } = countDiffInsertionsAndDeletions(parsed.files[0]);
		assert.strictEqual(insertions, 0, 'Should return 0 insertions for rename');
		assert.strictEqual(deletions, 0, 'Should return 0 deletions for rename');
	});

	test('counts across multiple hunks', () => {
		const diff = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,2 +1,3 @@
 line 1
+new line 1
 line 2
@@ -10,3 +11,2 @@
 line 10
-removed line
 line 11`;

		const parsed = parseGitDiff(diff);
		assert.strictEqual(parsed.files.length, 1);

		const { insertions, deletions } = countDiffInsertionsAndDeletions(parsed.files[0]);
		// First hunk: prev 2, curr 3
		// Second hunk: prev 3, curr 2
		assert.strictEqual(insertions, 5, 'Should sum current lines from all hunks');
		assert.strictEqual(deletions, 5, 'Should sum previous lines from all hunks');
	});
});
