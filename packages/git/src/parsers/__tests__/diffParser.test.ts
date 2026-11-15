import * as assert from 'assert';
import { GitFileIndexStatus } from '../../models/fileStatus.js';
import {
	countDiffInsertionsAndDeletions,
	countDiffLines,
	filterDiffFiles,
	parseGitApplyFiles,
	parseGitDiff,
	parseGitDiffNumStatFiles,
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

	suite('parseGitDiff file paths', () => {
		// Sections are as `git diff` writes them with `core.quotepath=false`, a tab ending an unquoted `---`/`+++` name
		// that holds a space
		const hunk = ['@@ -1 +1,2 @@', ' one', '+two'];

		function parseOne(lines: string[]) {
			const result = parseGitDiff(lines.join('\n'));
			assert.strictEqual(result.files.length, 1);
			return result.files[0];
		}

		test('reads a path holding " b/" from an edit', () => {
			const file = parseOne([
				'diff --git a/Plan b/notes.md b/Plan b/notes.md',
				'index 1111111..2222222 100644',
				'--- a/Plan b/notes.md\t',
				'+++ b/Plan b/notes.md\t',
				...hunk,
			]);

			assert.strictEqual(file.path, 'Plan b/notes.md');
			assert.strictEqual(file.originalPath, undefined);
			assert.strictEqual(file.status, GitFileIndexStatus.Modified);
		});

		test('reads a path holding " b/" from a mode change', () => {
			const file = parseOne(['diff --git a/Plan b/run.sh b/Plan b/run.sh', 'old mode 100644', 'new mode 100755']);

			assert.strictEqual(file.path, 'Plan b/run.sh');
			assert.strictEqual(file.originalPath, undefined);
			assert.strictEqual(file.status, GitFileIndexStatus.TypeChanged);
		});

		test('reads both sides of a rename with edits that holds " b/"', () => {
			const file = parseOne([
				'diff --git a/ren ame.txt b/Plan b/ren ame.txt',
				'similarity index 85%',
				'rename from ren ame.txt',
				'rename to Plan b/ren ame.txt',
				'index 1111111..2222222 100644',
				'--- a/ren ame.txt\t',
				'+++ b/Plan b/ren ame.txt\t',
				...hunk,
			]);

			assert.strictEqual(file.path, 'Plan b/ren ame.txt');
			assert.strictEqual(file.originalPath, 'ren ame.txt');
			assert.strictEqual(file.status, GitFileIndexStatus.Renamed);
		});

		test('reads both sides of a pure rename that holds " b/"', () => {
			const file = parseOne([
				'diff --git a/Plan a/x.md b/Plan b/y.md',
				'similarity index 100%',
				'rename from Plan a/x.md',
				'rename to Plan b/y.md',
			]);

			assert.strictEqual(file.path, 'Plan b/y.md');
			assert.strictEqual(file.originalPath, 'Plan a/x.md');
			assert.strictEqual(file.status, GitFileIndexStatus.Renamed);
			assert.strictEqual(file.hunks.length, 0);
		});

		test('reads both sides of a copy that holds " b/"', () => {
			const file = parseOne([
				'diff --git a/Plan a/x.md b/Plan b/y.md',
				'similarity index 100%',
				'copy from Plan a/x.md',
				'copy to Plan b/y.md',
			]);

			assert.strictEqual(file.path, 'Plan b/y.md');
			assert.strictEqual(file.originalPath, 'Plan a/x.md');
			assert.strictEqual(file.status, GitFileIndexStatus.Copied);
		});

		test('unquotes a path holding a double quote', () => {
			const file = parseOne([
				'diff --git "a/q\\"uote.txt" "b/q\\"uote.txt"',
				'index 1111111..2222222 100644',
				'--- "a/q\\"uote.txt"',
				'+++ "b/q\\"uote.txt"',
				...hunk,
			]);

			assert.strictEqual(file.path, 'q"uote.txt');
			assert.strictEqual(file.originalPath, undefined);
		});

		test('unquotes a path holding a backslash', () => {
			const file = parseOne([
				'diff --git "a/back\\\\slash.txt" "b/back\\\\slash.txt"',
				'index 1111111..2222222 100644',
				'--- "a/back\\\\slash.txt"',
				'+++ "b/back\\\\slash.txt"',
				...hunk,
			]);

			assert.strictEqual(file.path, 'back\\slash.txt');
		});

		test('unquotes a path holding a tab', () => {
			const file = parseOne([
				'diff --git "a/tab\\there.txt" "b/tab\\there.txt"',
				'index 1111111..2222222 100644',
				'--- "a/tab\\there.txt"',
				'+++ "b/tab\\there.txt"',
				...hunk,
			]);

			assert.strictEqual(file.path, 'tab\there.txt');
		});

		test('unquotes a path holding a newline', () => {
			const file = parseOne([
				'diff --git "a/new\\nline.txt" "b/new\\nline.txt"',
				'index 1111111..2222222 100644',
				'--- "a/new\\nline.txt"',
				'+++ "b/new\\nline.txt"',
				...hunk,
			]);

			assert.strictEqual(file.path, 'new\nline.txt');
		});

		test('unquotes the other C escapes', () => {
			const file = parseOne([
				'diff --git "a/\\a\\b\\f\\r\\v.txt" "b/\\a\\b\\f\\r\\v.txt"',
				'old mode 100644',
				'new mode 100755',
			]);

			assert.strictEqual(file.path, '\x07\b\f\r\v.txt');
		});

		test('reads a quoted path that also holds a space, which git ends with a tab', () => {
			const file = parseOne([
				'diff --git "a/sp \\"ace\\".txt" "b/sp \\"ace\\".txt"',
				'index 1111111..2222222 100644',
				'--- "a/sp \\"ace\\".txt"\t',
				'+++ "b/sp \\"ace\\".txt"\t',
				...hunk,
			]);

			assert.strictEqual(file.path, 'sp "ace".txt');
		});

		test('reads a path holding a space, which git ends with a tab', () => {
			const file = parseOne([
				'diff --git a/sp ace.txt b/sp ace.txt',
				'index 1111111..2222222 100644',
				'--- a/sp ace.txt\t',
				'+++ b/sp ace.txt\t',
				...hunk,
			]);

			assert.strictEqual(file.path, 'sp ace.txt');
		});

		test('reads a non-ASCII path left raw', () => {
			const file = parseOne([
				'diff --git a/café 日本.txt b/café 日本.txt',
				'index 1111111..2222222 100644',
				'--- a/café 日本.txt\t',
				'+++ b/café 日本.txt\t',
				...hunk,
			]);

			assert.strictEqual(file.path, 'café 日本.txt');
		});

		test('decodes octal escapes as the bytes of a UTF-8 path', () => {
			const file = parseOne([
				'diff --git "a/caf\\303\\251 \\346\\227\\245.txt" "b/caf\\303\\251 \\346\\227\\245.txt"',
				'index 1111111..2222222 100644',
				'--- "a/caf\\303\\251 \\346\\227\\245.txt"\t',
				'+++ "b/caf\\303\\251 \\346\\227\\245.txt"\t',
				...hunk,
			]);

			assert.strictEqual(file.path, 'café 日.txt');
		});

		test('decodes an octal escape of a control character', () => {
			const file = parseOne([
				'diff --git "a/ctl\\001.txt" "b/ctl\\001.txt"',
				'index 1111111..2222222 100644',
				'--- "a/ctl\\001.txt"',
				'+++ "b/ctl\\001.txt"',
				...hunk,
			]);

			assert.strictEqual(file.path, 'ctl\x01.txt');
		});

		test('reads a deleted path from the old side', () => {
			const file = parseOne([
				'diff --git "a/move \\"me\\".txt" "b/move \\"me\\".txt"',
				'deleted file mode 100644',
				'index 1111111..0000000',
				'--- "a/move \\"me\\".txt"\t',
				'+++ /dev/null',
				'@@ -1 +0,0 @@',
				'-one',
			]);

			assert.strictEqual(file.path, 'move "me".txt');
			assert.strictEqual(file.originalPath, undefined);
			assert.strictEqual(file.status, GitFileIndexStatus.Deleted);
		});

		test('reads an added path from the new side', () => {
			const file = parseOne([
				'diff --git a/Plan b/new.md b/Plan b/new.md',
				'new file mode 100644',
				'index 0000000..1111111',
				'--- /dev/null',
				'+++ b/Plan b/new.md\t',
				'@@ -0,0 +1 @@',
				'+one',
			]);

			assert.strictEqual(file.path, 'Plan b/new.md');
			assert.strictEqual(file.originalPath, undefined);
			assert.strictEqual(file.status, GitFileIndexStatus.Added);
		});

		test('reads a binary file whose section has no ---/+++ lines', () => {
			const file = parseOne([
				'diff --git a/Plan b/bin.dat b/Plan b/bin.dat',
				'index 1111111..2222222 100644',
				'Binary files a/Plan b/bin.dat and b/Plan b/bin.dat differ',
			]);

			assert.strictEqual(file.path, 'Plan b/bin.dat');
			assert.strictEqual(file.originalPath, undefined);
			assert.strictEqual(file.metadata.binary, true);
		});

		test('reads a quoted binary file whose section has no ---/+++ lines', () => {
			const file = parseOne([
				'diff --git "a/bi\\"n.dat" "b/bi\\"n.dat"',
				'index 1111111..2222222 100644',
				'Binary files "a/bi\\"n.dat" and "b/bi\\"n.dat" differ',
			]);

			assert.strictEqual(file.path, 'bi"n.dat');
			assert.strictEqual(file.metadata.binary, true);
		});

		test('reads a pure rename to a quoted path from the rename lines, whose old side git leaves unquoted', () => {
			const file = parseOne([
				'diff --git a/del me.txt "b/moved \\"it\\".txt"',
				'similarity index 100%',
				'rename from del me.txt',
				'rename to "moved \\"it\\".txt"',
			]);

			assert.strictEqual(file.path, 'moved "it".txt');
			assert.strictEqual(file.originalPath, 'del me.txt');
			assert.strictEqual(file.status, GitFileIndexStatus.Renamed);
		});

		test('reads a pure rename between quoted paths', () => {
			const file = parseOne([
				'diff --git "a/tab\\told.txt" "b/new\\nline.txt"',
				'similarity index 100%',
				'rename from "tab\\told.txt"',
				'rename to "new\\nline.txt"',
			]);

			assert.strictEqual(file.path, 'new\nline.txt');
			assert.strictEqual(file.originalPath, 'tab\told.txt');
		});

		test('reads a mode change of a quoted path', () => {
			const file = parseOne(['diff --git "a/q\\"uote.sh" "b/q\\"uote.sh"', 'old mode 100644', 'new mode 100755']);

			assert.strictEqual(file.path, 'q"uote.sh');
			assert.strictEqual(file.originalPath, undefined);
			assert.strictEqual(file.status, GitFileIndexStatus.TypeChanged);
		});

		test('reads each file of a diff of several awkward paths', () => {
			const result = parseGitDiff(
				[
					'diff --git a/Plan b/notes.md b/Plan b/notes.md',
					'--- a/Plan b/notes.md\t',
					'+++ b/Plan b/notes.md\t',
					...hunk,
					'diff --git "a/q\\"uote.txt" "b/q\\"uote.txt"',
					'--- "a/q\\"uote.txt"',
					'+++ "b/q\\"uote.txt"',
					...hunk,
					'diff --git a/mode.sh b/mode.sh',
					'old mode 100644',
					'new mode 100755',
				].join('\n'),
			);

			assert.deepStrictEqual(
				result.files.map(f => f.path),
				['Plan b/notes.md', 'q"uote.txt', 'mode.sh'],
			);
		});

		test('keeps the header of a quoted path whole', () => {
			const file = parseOne([
				'diff --git "a/q\\"uote.txt" "b/q\\"uote.txt"',
				'--- "a/q\\"uote.txt"',
				'+++ "b/q\\"uote.txt"',
				...hunk,
			]);

			assert.strictEqual(
				file.header,
				'diff --git "a/q\\"uote.txt" "b/q\\"uote.txt"\n--- "a/q\\"uote.txt"\n+++ "b/q\\"uote.txt"',
			);
		});

		test('skips a section whose paths cannot be read', () => {
			assert.strictEqual(parseGitDiff('diff --git garbage\nindex 1111111..2222222 100644').files.length, 0);
		});
	});

	suite('filterDiffFiles paths', () => {
		test('names each file by its new-side path', async () => {
			const diff = [
				'diff --git a/Plan b/notes.md b/Plan b/notes.md\n--- a/Plan b/notes.md\t\n+++ b/Plan b/notes.md\t\n@@ -1 +1,2 @@\n one\n+two\n',
				'diff --git "a/q\\"uote.txt" "b/q\\"uote.txt"\n--- "a/q\\"uote.txt"\n+++ "b/q\\"uote.txt"\n@@ -1 +1,2 @@\n one\n+two\n',
				'diff --git a/del me.txt "b/moved \\"it\\".txt"\nsimilarity index 100%\nrename from del me.txt\nrename to "moved \\"it\\".txt"\n',
			].join('');

			let seen: string[] = [];
			const filtered = await filterDiffFiles(diff, paths => {
				seen = paths;
				return ['q"uote.txt'];
			});

			assert.deepStrictEqual(seen, ['Plan b/notes.md', 'q"uote.txt', 'moved "it".txt']);
			assert.ok(filtered.startsWith('diff --git "a/q\\"uote.txt"'));
			assert.ok(!filtered.includes('Plan b'));
		});
	});

	// `--summary` C-quotes a name even with `-z`, which only leaves the numstat names raw
	suite('summary paths git quotes', () => {
		test('parseGitDiffNumStatFiles promotes a created and a deleted path', () => {
			const data = [
				'1\t0\tnew "n".txt\0',
				'0\t1\tmove "me".txt\0',
				'1\t0\ttab\there.txt\0',
				' create mode 100644 "new \\"n\\".txt"\n',
				' delete mode 100644 "move \\"me\\".txt"\n',
				' delete mode 100644 "tab\\there.txt"\n',
			].join('');

			const files = parseGitDiffNumStatFiles(data, '/repo');

			assert.deepStrictEqual(
				files?.map(f => [f.path, f.status]),
				[
					['new "n".txt', 'A'],
					['move "me".txt', 'D'],
					['tab\there.txt', 'D'],
				],
			);
		});

		test('parseGitDiffNumStatFiles promotes a copy to a quoted path and a type change of one', () => {
			const data = [
				'0\t0\t\0dir b/plain.txt\0dir b/c"opy.txt\0',
				'0\t0\tq"uote.lnk\0',
				' copy dir b/plain.txt => "dir b/c\\"opy.txt" (100%)\n',
				' mode change 100644 => 120000 "q\\"uote.lnk"\n',
			].join('');

			const files = parseGitDiffNumStatFiles(data, '/repo');

			assert.deepStrictEqual(
				files?.map(f => [f.path, f.originalPath, f.status]),
				[
					['dir b/c"opy.txt', 'dir b/plain.txt', 'C'],
					['q"uote.lnk', undefined, 'T'],
				],
			);
		});

		test('parseGitDiffNumStatFiles promotes a copy whose quoted names hold braces', () => {
			const data = [
				'0\t0\t\0a{b".txt\0c".txt\0',
				'0\t0\t\0x".txt\0n}e".txt\0',
				' copy "a{b\\".txt" => "c\\".txt" (90%)\n',
				' copy "x\\".txt" => "n}e\\".txt" (90%)\n',
			].join('');

			const files = parseGitDiffNumStatFiles(data, '/repo');

			assert.deepStrictEqual(
				files?.map(f => [f.path, f.status]),
				[
					['c".txt', 'C'],
					['n}e".txt', 'C'],
				],
			);
		});
	});

	// `git apply --summary` writes names as they are, never C-quoted, with or without `-z`
	suite('parseGitApplyFiles paths', () => {
		test('reads a created and a deleted path that git would quote elsewhere', () => {
			const data = [
				'1\t0\tnew "n".txt\0',
				'0\t1\tmove "me".txt\0',
				' create mode 100644 new "n".txt\n',
				' delete mode 100644 move "me".txt\n',
			].join('');

			const files = parseGitApplyFiles(data, '/repo');

			assert.deepStrictEqual(
				files.map(f => [f.path, f.status]),
				[
					['new "n".txt', 'A'],
					['move "me".txt', 'D'],
				],
			);
		});

		test('reads a created path that looks quoted as it is', () => {
			const files = parseGitApplyFiles('1\t0\t"q"\0 create mode 100644 "q"\n', '/repo');

			assert.deepStrictEqual(
				files.map(f => [f.path, f.status]),
				[['"q"', 'A']],
			);
		});

		test('reads a created path holding a tab', () => {
			const files = parseGitApplyFiles('1\t0\ttab\there.txt\0 create mode 100644 tab\there.txt\n', '/repo');

			assert.deepStrictEqual(
				files.map(f => [f.path, f.status, f.stats?.additions]),
				[['tab\there.txt', 'A', 1]],
			);
		});

		test('lists a created path holding a backslash once', () => {
			const files = parseGitApplyFiles('1\t0\tnew\\file.txt\0 create mode 100644 new\\file.txt\n', '/repo');

			assert.deepStrictEqual(
				files.map(f => [f.path, f.status]),
				[['new\\file.txt', 'A']],
			);
		});

		test('reads a rename of a path holding a backslash as it is', () => {
			const files = parseGitApplyFiles(
				'0\t0\tback\\slash2.txt\0 rename back\\slash.txt => back\\slash2.txt (100%)\n',
				'/repo',
			);

			assert.deepStrictEqual(
				files.map(f => [f.path, f.originalPath, f.status]),
				[['back\\slash2.txt', 'back\\slash.txt', 'R']],
			);
		});

		test('skips a summary line naming no listed file', () => {
			const files = parseGitApplyFiles('1\t0\ta.txt\0 create mode 100644 b.txt\n', '/repo');

			assert.deepStrictEqual(
				files.map(f => [f.path, f.status]),
				[['a.txt', 'M']],
			);
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

		test('parses a renamed-file diff (rename with content changes)', () => {
			// Reproduces what git emits with `-M --diff-filter=MRC` for a file that was
			// renamed AND modified in a commit. Regression guard: before filters included
			// R/C, hover/gutter diffs on renamed files silently returned no hunks.
			const data = [
				'diff --git a/src/old.ts b/src/new.ts',
				'similarity index 82%',
				'rename from src/old.ts',
				'rename to src/new.ts',
				'--- a/src/old.ts',
				'+++ b/src/new.ts',
				'@@ -1,3 +1,3 @@',
				' const a = 1;',
				'-const b = 2;',
				'+const b = 3;',
				' const c = 4;',
			].join('\n');

			const result = parseGitFileDiff(data);

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.hunks.length, 1);

			const hunk = result!.hunks[0];
			assert.strictEqual(hunk.current.position.start, 1);
			assert.strictEqual(hunk.previous.position.start, 1);

			const lines = [...hunk.lines.values()];
			assert.strictEqual(lines.find(l => l.state === 'changed')?.previous, 'const b = 2;');
			assert.strictEqual(lines.find(l => l.state === 'changed')?.current, 'const b = 3;');
		});
	});

	suite('parseGitDiffNumStatFiles', () => {
		test('parses a modified file and populates stats', () => {
			const data = '3\t1\tsrc/foo.ts\0';

			const result = parseGitDiffNumStatFiles(data, '/repo');

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.length, 1);
			assert.strictEqual(result![0].status, 'M');
			assert.strictEqual(result![0].path, 'src/foo.ts');
			assert.strictEqual(result![0].originalPath, undefined);
			assert.strictEqual(result![0].repoPath, '/repo');
			assert.deepStrictEqual(result![0].stats, { additions: 3, deletions: 1, changes: 4 });
		});

		test('parses an added file (promoted via summary)', () => {
			const data = '5\t0\tsrc/new.ts\0 create mode 100644 src/new.ts\n';

			const result = parseGitDiffNumStatFiles(data, '/repo');

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.length, 1);
			assert.strictEqual(result![0].status, 'A');
			assert.strictEqual(result![0].path, 'src/new.ts');
			assert.deepStrictEqual(result![0].stats, { additions: 5, deletions: 0, changes: 5 });
		});

		test('parses a deleted file (promoted via summary)', () => {
			const data = '0\t8\tsrc/old.ts\0 delete mode 100644 src/old.ts\n';

			const result = parseGitDiffNumStatFiles(data, '/repo');

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.length, 1);
			assert.strictEqual(result![0].status, 'D');
			assert.strictEqual(result![0].path, 'src/old.ts');
			assert.deepStrictEqual(result![0].stats, { additions: 0, deletions: 8, changes: 8 });
		});

		test('parses a rename from the numstat section', () => {
			const data = '2\t3\t\0src/old.ts\0src/new.ts\0 rename src/old.ts => src/new.ts (92%)\n';

			const result = parseGitDiffNumStatFiles(data, '/repo');

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.length, 1);
			assert.strictEqual(result![0].status, 'R');
			assert.strictEqual(result![0].path, 'src/new.ts');
			assert.strictEqual(result![0].originalPath, 'src/old.ts');
			assert.deepStrictEqual(result![0].stats, { additions: 2, deletions: 3, changes: 5 });
		});

		test('promotes copy to C via summary (full form)', () => {
			const data = '2\t0\t\0src/original.ts\0src/copy.ts\0 copy src/original.ts => src/copy.ts (90%)\n';

			const result = parseGitDiffNumStatFiles(data, '/repo');

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.length, 1);
			assert.strictEqual(result![0].status, 'C');
			assert.strictEqual(result![0].path, 'src/copy.ts');
			assert.strictEqual(result![0].originalPath, 'src/original.ts');
		});

		test('promotes copy to C via summary (compact form)', () => {
			const data = '1\t0\t\0src/original.ts\0src/copy.ts\0 copy src/{original.ts => copy.ts} (95%)\n';

			const result = parseGitDiffNumStatFiles(data, '/repo');

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.length, 1);
			assert.strictEqual(result![0].status, 'C');
			assert.strictEqual(result![0].path, 'src/copy.ts');
			assert.strictEqual(result![0].originalPath, 'src/original.ts');
		});

		test('promotes copy to C via summary (compact mid-form with suffix)', () => {
			const data =
				'1\t0\t\0packages/foo/src/baz.ts\0packages/bar/src/baz.ts\0' +
				' copy packages/{foo => bar}/src/baz.ts (100%)\n';

			const result = parseGitDiffNumStatFiles(data, '/repo');

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.length, 1);
			assert.strictEqual(result![0].status, 'C');
			assert.strictEqual(result![0].path, 'packages/bar/src/baz.ts');
			assert.strictEqual(result![0].originalPath, 'packages/foo/src/baz.ts');
		});

		test('rename summary line leaves status as R (not promoted to C)', () => {
			const data = '4\t2\t\0src/old.ts\0src/new.ts\0 rename src/{old.ts => new.ts} (90%)\n';

			const result = parseGitDiffNumStatFiles(data, '/repo');

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.length, 1);
			assert.strictEqual(result![0].status, 'R');
			assert.strictEqual(result![0].path, 'src/new.ts');
			assert.strictEqual(result![0].originalPath, 'src/old.ts');
		});

		test('promotes type change to T when mode family differs (file to symlink)', () => {
			const data = '1\t1\tsrc/link.ts\0 mode change 100644 => 120000 src/link.ts\n';

			const result = parseGitDiffNumStatFiles(data, '/repo');

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.length, 1);
			assert.strictEqual(result![0].status, 'T');
			assert.strictEqual(result![0].path, 'src/link.ts');
		});

		test('leaves status as M for permission-only mode changes', () => {
			const data = '0\t0\tscripts/run.sh\0 mode change 100644 => 100755 scripts/run.sh\n';

			const result = parseGitDiffNumStatFiles(data, '/repo');

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.length, 1);
			assert.strictEqual(result![0].status, 'M');
			assert.strictEqual(result![0].path, 'scripts/run.sh');
		});

		test('parses a binary file with zero stats', () => {
			const data = '-\t-\tassets/icon.png\0 create mode 100644 assets/icon.png\n';

			const result = parseGitDiffNumStatFiles(data, '/repo');

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.length, 1);
			assert.strictEqual(result![0].status, 'A');
			assert.strictEqual(result![0].path, 'assets/icon.png');
			assert.deepStrictEqual(result![0].stats, { additions: 0, deletions: 0, changes: 0 });
		});

		test('parses an undetected rename as an A + D pair (renameLimit=0 fallback)', () => {
			const data =
				'0\t5\tsrc/old.ts\0' +
				'5\t0\tsrc/new.ts\0' +
				' create mode 100644 src/new.ts\n delete mode 100644 src/old.ts\n';

			const result = parseGitDiffNumStatFiles(data, '/repo');

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.length, 2);

			const deleted = result!.find(f => f.path === 'src/old.ts');
			const added = result!.find(f => f.path === 'src/new.ts');
			assert.ok(deleted, 'deleted entry should exist');
			assert.ok(added, 'added entry should exist');
			assert.strictEqual(deleted.status, 'D');
			assert.strictEqual(added.status, 'A');
		});

		test('parses multiple mixed entries in one payload', () => {
			const data =
				'2\t1\tsrc/modified.ts\0' +
				'10\t0\tsrc/added.ts\0' +
				'0\t4\tsrc/deleted.ts\0' +
				'3\t2\t\0src/old.ts\0src/renamed.ts\0' +
				' create mode 100644 src/added.ts\n delete mode 100644 src/deleted.ts\n rename src/old.ts => src/renamed.ts (80%)\n';

			const result = parseGitDiffNumStatFiles(data, '/repo');

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.length, 4);

			const modified = result!.find(f => f.path === 'src/modified.ts');
			const added = result!.find(f => f.path === 'src/added.ts');
			const deleted = result!.find(f => f.path === 'src/deleted.ts');
			const renamed = result!.find(f => f.path === 'src/renamed.ts');
			assert.strictEqual(modified!.status, 'M');
			assert.strictEqual(added!.status, 'A');
			assert.strictEqual(deleted!.status, 'D');
			assert.strictEqual(renamed!.status, 'R');
			assert.strictEqual(renamed!.originalPath, 'src/old.ts');
		});

		test('handles a payload with only modifications (no summary section)', () => {
			const data = '1\t1\ta.ts\x002\t0\tb.ts\0';

			const result = parseGitDiffNumStatFiles(data, '/repo');

			assert.notStrictEqual(result, undefined);
			assert.strictEqual(result!.length, 2);
			assert.strictEqual(result![0].status, 'M');
			assert.strictEqual(result![1].status, 'M');
		});

		test('returns undefined for empty data', () => {
			const result = parseGitDiffNumStatFiles('', '/repo');

			assert.strictEqual(result, undefined);
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
		test('counts insertions and deletions from hunks, excluding context lines', () => {
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

			assert.strictEqual(counts.insertions, 1);
			assert.strictEqual(counts.deletions, 0);
		});

		test('counts an asymmetric change block', () => {
			const data = [
				'diff --git a/src/foo.ts b/src/foo.ts',
				'index abc1234..def5678 100644',
				'--- a/src/foo.ts',
				'+++ b/src/foo.ts',
				'@@ -1,5 +1,3 @@',
				' line1',
				'-old1',
				'-old2',
				'-old3',
				'+new1',
				' line5',
			].join('\n');

			const result = parseGitDiff(data);
			const counts = countDiffInsertionsAndDeletions(result.files[0]);

			assert.strictEqual(counts.insertions, 1);
			assert.strictEqual(counts.deletions, 3);
		});

		test('counts an added file with no deletions', () => {
			const data = [
				'diff --git a/new.txt b/new.txt',
				'new file mode 100644',
				'index 0000000..abc1234',
				'--- /dev/null',
				'+++ b/new.txt',
				'@@ -0,0 +1 @@',
				'+hello',
			].join('\n');

			const result = parseGitDiff(data);
			assert.strictEqual(result.files[0].status, GitFileIndexStatus.Added);

			const counts = countDiffInsertionsAndDeletions(result.files[0]);

			assert.strictEqual(counts.insertions, 1);
			assert.strictEqual(counts.deletions, 0);
		});

		test('counts a deleted file with no insertions', () => {
			const data = [
				'diff --git a/gone.txt b/gone.txt',
				'deleted file mode 100644',
				'index abc1234..0000000',
				'--- a/gone.txt',
				'+++ /dev/null',
				'@@ -1,2 +0,0 @@',
				'-line1',
				'-line2',
			].join('\n');

			const result = parseGitDiff(data);
			assert.strictEqual(result.files[0].status, GitFileIndexStatus.Deleted);

			const counts = countDiffInsertionsAndDeletions(result.files[0]);

			assert.strictEqual(counts.insertions, 0);
			assert.strictEqual(counts.deletions, 2);
		});

		test('ignores the no-newline marker', () => {
			const data = [
				'diff --git a/src/foo.ts b/src/foo.ts',
				'index abc1234..def5678 100644',
				'--- a/src/foo.ts',
				'+++ b/src/foo.ts',
				'@@ -1 +1 @@',
				'-old',
				'\\ No newline at end of file',
				'+new',
				'\\ No newline at end of file',
			].join('\n');

			const result = parseGitDiff(data);
			const counts = countDiffInsertionsAndDeletions(result.files[0]);

			assert.strictEqual(counts.insertions, 1);
			assert.strictEqual(counts.deletions, 1);
		});

		test('returns zeros for a pure rename and for a binary file', () => {
			const rename = [
				'diff --git a/old.ts b/new.ts',
				'similarity index 100%',
				'rename from old.ts',
				'rename to new.ts',
			].join('\n');

			let result = parseGitDiff(rename);
			assert.strictEqual(result.files[0].status, GitFileIndexStatus.Renamed);
			assert.deepStrictEqual(countDiffInsertionsAndDeletions(result.files[0]), {
				insertions: 0,
				deletions: 0,
			});

			const binary = [
				'diff --git a/logo.png b/logo.png',
				'index abc1234..def5678 100644',
				'Binary files a/logo.png and b/logo.png differ',
			].join('\n');

			result = parseGitDiff(binary);
			assert.strictEqual(result.files[0].metadata.binary, true);
			assert.deepStrictEqual(countDiffInsertionsAndDeletions(result.files[0]), {
				insertions: 0,
				deletions: 0,
			});
		});

		test('counts annotated diff content (as sent to the AI)', () => {
			const data = [
				'diff --git a/src/foo.ts b/src/foo.ts',
				'index abc1234..def5678 100644',
				'--- a/src/foo.ts',
				'+++ b/src/foo.ts',
				'@@ -1,3 +1,3 @@',
				' [    1] line1',
				'-[     ] old',
				'+[    2] new',
				' [    3] line3',
			].join('\n');

			const result = parseGitDiff(data);
			const counts = countDiffInsertionsAndDeletions(result.files[0]);

			assert.strictEqual(counts.insertions, 1);
			assert.strictEqual(counts.deletions, 1);
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
