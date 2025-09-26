import * as assert from 'assert';
import { parseGitDiff } from '../diffParser';

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
