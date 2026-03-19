import * as assert from 'assert';
import { GitFileIndexStatus } from '../../models/fileStatus.js';
import {
	countDiffInsertionsAndDeletions,
	countDiffLines,
	parseGitDiff,
	parseGitDiffNameStatusFiles,
	parseGitDiffShortStat,
	parseGitFileDiff,
} from '../diffParser.js';

suite('Diff Parser Test Suite', () => {
	suite('parseGitDiff', () => {
		test('parses a modified file with additions and deletions', () => {
			const data = [
				'diff --git a/src/foo.ts b/src/foo.ts',
				'index abc1234..def5678 100644',
				'--- a/src/foo.ts',
				'+++ b/src/foo.ts',
				'@@ -1,5 +1,6 @@',
				" import { bar } from './bar';",
				' ',
				"+import { baz } from './baz';",
				' export function foo() {',
				'-  return bar();',
				'+  return bar() + baz();',
				' }',
			].join('\n');

			const result = parseGitDiff(data);

			assert.strictEqual(result.files.length, 1);
			const file = result.files[0];
			assert.strictEqual(file.path, 'src/foo.ts');
			assert.strictEqual(file.originalPath, undefined);
			assert.strictEqual(file.status, GitFileIndexStatus.Modified);
			assert.strictEqual(file.metadata.binary, false);
			assert.strictEqual(file.metadata.modeChanged, false);
			assert.strictEqual(file.metadata.renamedOrCopied, false);
			assert.strictEqual(file.hunks.length, 1);

			const hunk = file.hunks[0];
			assert.strictEqual(hunk.previous.position.start, 1);
			assert.strictEqual(hunk.previous.count, 5);
			assert.strictEqual(hunk.current.position.start, 1);
			assert.strictEqual(hunk.current.count, 6);
		});

		test('parses a new file', () => {
			const data = [
				'diff --git a/src/newFile.ts b/src/newFile.ts',
				'new file mode 100644',
				'index 0000000..abc1234',
				'--- /dev/null',
				'+++ b/src/newFile.ts',
				'@@ -0,0 +1,3 @@',
				'+export function hello() {',
				"+  return 'world';",
				'+}',
			].join('\n');

			const result = parseGitDiff(data);

			assert.strictEqual(result.files.length, 1);
			const file = result.files[0];
			assert.strictEqual(file.path, 'src/newFile.ts');
			assert.strictEqual(file.status, GitFileIndexStatus.Added);
			assert.strictEqual(file.metadata.binary, false);
			assert.strictEqual(file.hunks.length, 1);

			const hunk = file.hunks[0];
			assert.strictEqual(hunk.current.count, 3);
			// parseHunkHeaderPart uses `Number(countS) || 1`, so 0 becomes 1
			assert.strictEqual(hunk.previous.count, 1);
			assert.strictEqual(hunk.previous.position.start, 0);
		});

		test('parses a deleted file', () => {
			const data = [
				'diff --git a/src/old.ts b/src/old.ts',
				'deleted file mode 100644',
				'index abc1234..0000000',
				'--- a/src/old.ts',
				'+++ /dev/null',
				'@@ -1,4 +0,0 @@',
				'-export function old() {',
				"-  return 'gone';",
				'-}',
				'-',
			].join('\n');

			const result = parseGitDiff(data);

			assert.strictEqual(result.files.length, 1);
			const file = result.files[0];
			assert.strictEqual(file.path, 'src/old.ts');
			assert.strictEqual(file.status, GitFileIndexStatus.Deleted);
			assert.strictEqual(file.metadata.binary, false);
		});

		test('parses a renamed file with similarity index', () => {
			const data = [
				'diff --git a/src/oldName.ts b/src/newName.ts',
				'similarity index 95%',
				'rename from src/oldName.ts',
				'rename to src/newName.ts',
				'index abc1234..def5678 100644',
				'--- a/src/oldName.ts',
				'+++ b/src/newName.ts',
				'@@ -1,3 +1,3 @@',
				' export function hello() {',
				"-  return 'old';",
				"+  return 'new';",
				' }',
			].join('\n');

			const result = parseGitDiff(data);

			assert.strictEqual(result.files.length, 1);
			const file = result.files[0];
			assert.strictEqual(file.path, 'src/newName.ts');
			assert.strictEqual(file.originalPath, 'src/oldName.ts');
			assert.strictEqual(file.status, GitFileIndexStatus.Renamed);
			assert.notStrictEqual(file.metadata.renamedOrCopied, false);
			if (file.metadata.renamedOrCopied !== false) {
				assert.strictEqual(file.metadata.renamedOrCopied.similarity, 95);
			}
		});

		test('parses a binary file diff', () => {
			const data = [
				'diff --git a/assets/logo.png b/assets/logo.png',
				'index abc1234..def5678 100644',
				'Binary files a/assets/logo.png and b/assets/logo.png differ',
			].join('\n');

			const result = parseGitDiff(data);

			assert.strictEqual(result.files.length, 1);
			const file = result.files[0];
			assert.strictEqual(file.path, 'assets/logo.png');
			assert.strictEqual(file.status, GitFileIndexStatus.Modified);
			assert.strictEqual(file.metadata.binary, true);
			assert.strictEqual(file.hunks.length, 0);
		});

		test('parses a mode change only (no content changes)', () => {
			const data = ['diff --git a/scripts/run.sh b/scripts/run.sh', 'old mode 100644', 'new mode 100755'].join(
				'\n',
			);

			const result = parseGitDiff(data);

			assert.strictEqual(result.files.length, 1);
			const file = result.files[0];
			assert.strictEqual(file.path, 'scripts/run.sh');
			assert.strictEqual(file.status, GitFileIndexStatus.TypeChanged);
			assert.notStrictEqual(file.metadata.modeChanged, false);
			if (file.metadata.modeChanged !== false) {
				assert.strictEqual(file.metadata.modeChanged.oldMode, '100644');
				assert.strictEqual(file.metadata.modeChanged.newMode, '100755');
			}
		});

		test('parses multiple files in a single diff', () => {
			const data = [
				'diff --git a/src/a.ts b/src/a.ts',
				'index 1111111..2222222 100644',
				'--- a/src/a.ts',
				'+++ b/src/a.ts',
				'@@ -1,3 +1,4 @@',
				' line1',
				'+added line',
				' line2',
				' line3',
				'diff --git a/src/b.ts b/src/b.ts',
				'new file mode 100644',
				'index 0000000..3333333',
				'--- /dev/null',
				'+++ b/src/b.ts',
				'@@ -0,0 +1,2 @@',
				'+export const x = 1;',
				'+export const y = 2;',
				'diff --git a/src/c.ts b/src/c.ts',
				'deleted file mode 100644',
				'index 4444444..0000000',
				'--- a/src/c.ts',
				'+++ /dev/null',
				'@@ -1,2 +0,0 @@',
				'-const old = true;',
				'-export default old;',
			].join('\n');

			const result = parseGitDiff(data);

			assert.strictEqual(result.files.length, 3);
			assert.strictEqual(result.files[0].path, 'src/a.ts');
			assert.strictEqual(result.files[0].status, GitFileIndexStatus.Modified);
			assert.strictEqual(result.files[1].path, 'src/b.ts');
			assert.strictEqual(result.files[1].status, GitFileIndexStatus.Added);
			assert.strictEqual(result.files[2].path, 'src/c.ts');
			assert.strictEqual(result.files[2].status, GitFileIndexStatus.Deleted);
		});

		test('preserves rawContent when includeRawContent is true', () => {
			const data = [
				'diff --git a/src/foo.ts b/src/foo.ts',
				'index abc1234..def5678 100644',
				'--- a/src/foo.ts',
				'+++ b/src/foo.ts',
				'@@ -1,3 +1,3 @@',
				' const a = 1;',
				'-const b = 2;',
				'+const b = 3;',
				' const c = 4;',
			].join('\n');

			const result = parseGitDiff(data, true);

			assert.strictEqual(result.rawContent, data);
			assert.strictEqual(result.files.length, 1);
			assert.notStrictEqual(result.files[0].rawContent, undefined);
		});

		test('does not include rawContent when includeRawContent is false', () => {
			const data = [
				'diff --git a/src/foo.ts b/src/foo.ts',
				'index abc1234..def5678 100644',
				'--- a/src/foo.ts',
				'+++ b/src/foo.ts',
				'@@ -1,3 +1,3 @@',
				' const a = 1;',
				'-const b = 2;',
				'+const b = 3;',
				' const c = 4;',
			].join('\n');

			const result = parseGitDiff(data, false);

			assert.strictEqual(result.rawContent, undefined);
			assert.strictEqual(result.files[0].rawContent, undefined);
		});

		test('returns empty files array for empty data', () => {
			const result = parseGitDiff('');

			assert.strictEqual(result.files.length, 0);
			assert.strictEqual(result.rawContent, undefined);
		});

		test('parses a copied file with similarity index', () => {
			const data = [
				'diff --git a/src/original.ts b/src/copy.ts',
				'similarity index 100%',
				'copy from src/original.ts',
				'copy to src/copy.ts',
			].join('\n');

			const result = parseGitDiff(data);

			assert.strictEqual(result.files.length, 1);
			const file = result.files[0];
			assert.strictEqual(file.path, 'src/copy.ts');
			assert.strictEqual(file.originalPath, 'src/original.ts');
			assert.strictEqual(file.status, GitFileIndexStatus.Copied);
			assert.notStrictEqual(file.metadata.renamedOrCopied, false);
			if (file.metadata.renamedOrCopied !== false) {
				assert.strictEqual(file.metadata.renamedOrCopied.similarity, 100);
			}
		});

		test('parses a mode change with content changes as Modified', () => {
			const data = [
				'diff --git a/scripts/run.sh b/scripts/run.sh',
				'old mode 100644',
				'new mode 100755',
				'index abc1234..def5678',
				'--- a/scripts/run.sh',
				'+++ b/scripts/run.sh',
				'@@ -1,2 +1,3 @@',
				' #!/bin/bash',
				'+set -e',
				' echo "hello"',
			].join('\n');

			const result = parseGitDiff(data);

			assert.strictEqual(result.files.length, 1);
			const file = result.files[0];
			assert.strictEqual(file.path, 'scripts/run.sh');
			// When there are hunks alongside mode change, status is Modified (not TypeChanged)
			assert.strictEqual(file.status, GitFileIndexStatus.Modified);
			assert.notStrictEqual(file.metadata.modeChanged, false);
			if (file.metadata.modeChanged !== false) {
				assert.strictEqual(file.metadata.modeChanged.oldMode, '100644');
				assert.strictEqual(file.metadata.modeChanged.newMode, '100755');
			}
			assert.strictEqual(file.hunks.length, 1);
		});
	});

	suite('parseGitFileDiff', () => {
		test('parses a single hunk with additions, deletions, and context', () => {
			const data = [
				'@@ -1,5 +1,6 @@',
				" import { bar } from './bar';",
				' ',
				"+import { baz } from './baz';",
				' export function foo() {',
				'-  return bar();',
				'+  return bar() + baz();',
				' }',
			].join('\n');

			const result = parseGitFileDiff(data);

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.hunks.length, 1);

			const hunk = result!.hunks[0];
			assert.strictEqual(hunk.previous.position.start, 1);
			assert.strictEqual(hunk.previous.count, 5);
			assert.strictEqual(hunk.current.position.start, 1);
			assert.strictEqual(hunk.current.count, 6);

			// Verify individual line states
			const lines = [...hunk.lines.entries()];
			// Line 1: context (import bar)
			assert.strictEqual(lines[0][1].state, 'unchanged');
			// Line 2: context (blank)
			assert.strictEqual(lines[1][1].state, 'unchanged');
			// Line 3: added (import baz)
			assert.strictEqual(lines[2][1].state, 'added');
			assert.strictEqual(lines[2][1].current, "import { baz } from './baz';");
			// Line 4: context (export function)
			assert.strictEqual(lines[3][1].state, 'unchanged');
			// Line 5: changed (return bar -> return bar + baz)
			assert.strictEqual(lines[4][1].state, 'changed');
			assert.strictEqual(lines[4][1].previous, '  return bar();');
			assert.strictEqual(lines[4][1].current, '  return bar() + baz();');
			// Line 6: context (closing brace)
			assert.strictEqual(lines[5][1].state, 'unchanged');
		});

		test('parses multiple hunks', () => {
			const data = [
				'@@ -1,4 +1,5 @@',
				" import { a } from './a';",
				"+import { b } from './b';",
				' ',
				' function first() {',
				'   return a();',
				'@@ -10,4 +11,5 @@',
				' function second() {',
				'-  return null;',
				'+  return b();',
				'+  // updated',
				' }',
			].join('\n');

			const result = parseGitFileDiff(data);

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.hunks.length, 2);

			assert.strictEqual(result!.hunks[0].previous.position.start, 1);
			assert.strictEqual(result!.hunks[0].current.position.start, 1);
			assert.strictEqual(result!.hunks[0].current.count, 5);

			assert.strictEqual(result!.hunks[1].previous.position.start, 10);
			assert.strictEqual(result!.hunks[1].current.position.start, 11);
			assert.strictEqual(result!.hunks[1].current.count, 5);
		});

		test('returns undefined for empty data', () => {
			const result = parseGitFileDiff('');

			assert.strictEqual(result, undefined);
		});

		test('preserves rawContent when includeRawContent is true', () => {
			const data = ['@@ -1,3 +1,3 @@', ' const a = 1;', '-const b = 2;', '+const b = 3;', ' const c = 4;'].join(
				'\n',
			);

			const result = parseGitFileDiff(data, true);

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.rawContent, data);
		});

		test('does not include rawContent when includeRawContent is false', () => {
			const data = ['@@ -1,3 +1,3 @@', ' const a = 1;', '-const b = 2;', '+const b = 3;', ' const c = 4;'].join(
				'\n',
			);

			const result = parseGitFileDiff(data, false);

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.rawContent, undefined);
		});

		test('parses only additions', () => {
			const data = ['@@ -0,0 +1,3 @@', '+line one', '+line two', '+line three'].join('\n');

			const result = parseGitFileDiff(data);

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.hunks.length, 1);

			const hunk = result!.hunks[0];
			assert.strictEqual(hunk.current.count, 3);
			// parseHunkHeaderPart uses `Number(countS) || 1`, so 0 becomes 1
			assert.strictEqual(hunk.previous.count, 1);

			const lines = [...hunk.lines.values()];
			assert.ok(lines.every(l => l.state === 'added'));
		});

		test('parses only deletions', () => {
			const data = ['@@ -1,3 +0,0 @@', '-line one', '-line two', '-line three'].join('\n');

			const result = parseGitFileDiff(data);

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.hunks.length, 1);

			const hunk = result!.hunks[0];
			// parseHunkHeaderPart uses `Number(countS) || 1`, so 0 becomes 1
			assert.strictEqual(hunk.current.count, 1);
			assert.strictEqual(hunk.previous.count, 3);

			const lines = [...hunk.lines.values()];
			assert.ok(lines.every(l => l.state === 'removed'));
		});

		test('parses a hunk header without count (defaults to 1)', () => {
			const data = ['@@ -5 +5 @@', '-old line', '+new line'].join('\n');

			const result = parseGitFileDiff(data);

			assert.notStrictEqual(result, undefined);
			const hunk = result!.hunks[0];
			assert.strictEqual(hunk.previous.count, 1);
			assert.strictEqual(hunk.current.count, 1);
			assert.strictEqual(hunk.previous.position.start, 5);
			assert.strictEqual(hunk.previous.position.end, 5);
			assert.strictEqual(hunk.current.position.start, 5);
			assert.strictEqual(hunk.current.position.end, 5);
		});

		test('skips header lines before the first hunk', () => {
			const data = ['--- a/src/foo.ts', '+++ b/src/foo.ts', '@@ -1,2 +1,2 @@', '-old', '+new', ' context'].join(
				'\n',
			);

			const result = parseGitFileDiff(data);

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.hunks.length, 1);
			assert.strictEqual(result!.hunks[0].current.position.start, 1);
		});
	});

	suite('parseGitDiffNameStatusFiles', () => {
		test('parses a modified file', () => {
			const data = 'M\0src/foo.ts\0';

			const result = parseGitDiffNameStatusFiles(data, '/repo');

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.length, 1);
			assert.strictEqual(result![0].status, 'M');
			assert.strictEqual(result![0].path, 'src/foo.ts');
			assert.strictEqual(result![0].originalPath, undefined);
			assert.strictEqual(result![0].repoPath, '/repo');
		});

		test('parses a renamed file with old and new paths', () => {
			const data = 'R100\0src/old.ts\0src/new.ts\0';

			const result = parseGitDiffNameStatusFiles(data, '/repo');

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.length, 1);
			assert.strictEqual(result![0].status, 'R');
			assert.strictEqual(result![0].path, 'src/new.ts');
			assert.strictEqual(result![0].originalPath, 'src/old.ts');
		});

		test('parses a copied file with old and new paths', () => {
			const data = 'C100\0src/original.ts\0src/copy.ts\0';

			const result = parseGitDiffNameStatusFiles(data, '/repo');

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.length, 1);
			assert.strictEqual(result![0].status, 'C');
			assert.strictEqual(result![0].path, 'src/copy.ts');
			assert.strictEqual(result![0].originalPath, 'src/original.ts');
		});

		test('parses multiple files of different types', () => {
			const data = 'M\0src/modified.ts\0A\0src/added.ts\0D\0src/deleted.ts\0R100\0src/old.ts\0src/renamed.ts\0';

			const result = parseGitDiffNameStatusFiles(data, '/repo');

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.length, 4);

			assert.strictEqual(result![0].status, 'M');
			assert.strictEqual(result![0].path, 'src/modified.ts');

			assert.strictEqual(result![1].status, 'A');
			assert.strictEqual(result![1].path, 'src/added.ts');

			assert.strictEqual(result![2].status, 'D');
			assert.strictEqual(result![2].path, 'src/deleted.ts');

			assert.strictEqual(result![3].status, 'R');
			assert.strictEqual(result![3].path, 'src/renamed.ts');
			assert.strictEqual(result![3].originalPath, 'src/old.ts');
		});

		test('returns undefined for empty data', () => {
			const result = parseGitDiffNameStatusFiles('', '/repo');

			assert.strictEqual(result, undefined);
		});

		test('converts dot status to question mark', () => {
			const data = '.\0src/unchanged.ts\0';

			const result = parseGitDiffNameStatusFiles(data, '/repo');

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.length, 1);
			assert.strictEqual(result![0].status, '?');
		});

		test('parses added and deleted files', () => {
			const data = 'A\0src/new.ts\0D\0src/removed.ts\0';

			const result = parseGitDiffNameStatusFiles(data, '/repo');

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.length, 2);
			assert.strictEqual(result![0].status, 'A');
			assert.strictEqual(result![0].path, 'src/new.ts');
			assert.strictEqual(result![1].status, 'D');
			assert.strictEqual(result![1].path, 'src/removed.ts');
		});
	});

	suite('parseGitDiffShortStat', () => {
		test('parses all three fields (files, insertions, deletions)', () => {
			const data = ' 3 files changed, 10 insertions(+), 5 deletions(-)';

			const result = parseGitDiffShortStat(data);

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.files, 3);
			assert.strictEqual(result!.additions, 10);
			assert.strictEqual(result!.deletions, 5);
		});

		test('parses only insertions (no deletions)', () => {
			const data = ' 2 files changed, 15 insertions(+)';

			const result = parseGitDiffShortStat(data);

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.files, 2);
			assert.strictEqual(result!.additions, 15);
			assert.strictEqual(result!.deletions, 0);
		});

		test('parses only deletions (no insertions)', () => {
			const data = ' 1 file changed, 8 deletions(-)';

			const result = parseGitDiffShortStat(data);

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.files, 1);
			assert.strictEqual(result!.additions, 0);
			assert.strictEqual(result!.deletions, 8);
		});

		test('parses singular form (1 file changed)', () => {
			const data = ' 1 file changed, 1 insertion(+), 1 deletion(-)';

			const result = parseGitDiffShortStat(data);

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.files, 1);
			assert.strictEqual(result!.additions, 1);
			assert.strictEqual(result!.deletions, 1);
		});

		test('returns undefined for empty data', () => {
			const result = parseGitDiffShortStat('');

			assert.strictEqual(result, undefined);
		});

		test('returns undefined for non-matching data', () => {
			const result = parseGitDiffShortStat('not a short stat line');

			assert.strictEqual(result, undefined);
		});

		test('parses large numbers', () => {
			const data = ' 42 files changed, 1234 insertions(+), 567 deletions(-)';

			const result = parseGitDiffShortStat(data);

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.files, 42);
			assert.strictEqual(result!.additions, 1234);
			assert.strictEqual(result!.deletions, 567);
		});
	});

	suite('countDiffInsertionsAndDeletions', () => {
		test('counts insertions and deletions from hunks', () => {
			const data = [
				'diff --git a/src/foo.ts b/src/foo.ts',
				'index abc1234..def5678 100644',
				'--- a/src/foo.ts',
				'+++ b/src/foo.ts',
				'@@ -1,3 +1,4 @@',
				' line1',
				'+added',
				' line2',
				' line3',
			].join('\n');

			const result = parseGitDiff(data);
			const counts = countDiffInsertionsAndDeletions(result.files[0]);

			assert.strictEqual(counts.insertions, 4);
			assert.strictEqual(counts.deletions, 3);
		});
	});

	suite('countDiffLines', () => {
		test('counts total changed lines from hunks', () => {
			const data = [
				'diff --git a/src/foo.ts b/src/foo.ts',
				'index abc1234..def5678 100644',
				'--- a/src/foo.ts',
				'+++ b/src/foo.ts',
				'@@ -1,3 +1,4 @@',
				' line1',
				'+added',
				' line2',
				' line3',
			].join('\n');

			const result = parseGitDiff(data);
			const count = countDiffLines(result.files[0]);

			// current.count (4) + previous.count (3) = 7
			assert.strictEqual(count, 7);
		});

		test('returns 0 for a file with no hunks', () => {
			const data = ['diff --git a/scripts/run.sh b/scripts/run.sh', 'old mode 100644', 'new mode 100755'].join(
				'\n',
			);

			const result = parseGitDiff(data);
			const count = countDiffLines(result.files[0]);

			assert.strictEqual(count, 0);
		});
	});
});
