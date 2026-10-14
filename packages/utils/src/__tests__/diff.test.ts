import * as assert from 'assert';
import { annotateDiffWithNewLineNumbers, getAnnotatedNewLines, reanchorLineRange } from '../diff.js';

const unstaged = [
	'diff --git a/src/retry.ts b/src/retry.ts',
	'index 1111111..2222222 100644',
	'--- a/src/retry.ts',
	'+++ b/src/retry.ts',
	'@@ -10,3 +10,4 @@ export function retry() {',
	' const a = 1;',
	'-const b = 2;',
	'+const b = 3;',
	'+const c = 4;',
	' return a;',
].join('\n');

const staged = [
	'diff --git a/src/retry.ts b/src/retry.ts',
	'index 0000000..1111111 100644',
	'--- a/src/retry.ts',
	'+++ b/src/retry.ts',
	'@@ -1,2 +1,3 @@',
	' import { x } from "./x";',
	'+import { y } from "./y";',
	' ',
	'diff --git a/src/gone.ts b/src/gone.ts',
	'deleted file mode 100644',
	'--- a/src/gone.ts',
	'+++ /dev/null',
	'@@ -1 +0,0 @@',
	'-export const gone = true;',
].join('\n');

suite('Diff Test Suite', () => {
	suite('getAnnotatedNewLines', () => {
		test('maps each new-side line number to its text, per path', () => {
			const lines = getAnnotatedNewLines(annotateDiffWithNewLineNumbers(unstaged));
			const file = lines.get('src/retry.ts');
			assert.ok(file);
			assert.deepStrictEqual(file.get(10), ['const a = 1;']);
			assert.deepStrictEqual(file.get(11), ['const b = 3;']);
			assert.deepStrictEqual(file.get(12), ['const c = 4;']);
			assert.deepStrictEqual(file.get(13), ['return a;']);
			assert.strictEqual(file.size, 4, 'removed lines carry no new-side number');
		});

		test('keeps every part’s text when a path appears more than once', () => {
			const lines = getAnnotatedNewLines(annotateDiffWithNewLineNumbers(`${unstaged}\n${staged}`));
			const file = lines.get('src/retry.ts');
			assert.deepStrictEqual(file?.get(1), ['import { x } from "./x";']);
			assert.deepStrictEqual(file?.get(10), ['const a = 1;']);
			assert.strictEqual(lines.has('/dev/null'), false, 'a deleted file has no new side');
			assert.strictEqual(lines.has('src/gone.ts'), false);
		});
	});

	suite('reanchorLineRange', () => {
		const quoted = getAnnotatedNewLines(annotateDiffWithNewLineNumbers(unstaged)).get('src/retry.ts')!;

		function fileWith(lines: Record<number, string>, length = 20): string[] {
			return Array.from({ length: length }, (_, i) => lines[i + 1] ?? `// filler ${i + 1}`);
		}

		test('keeps a range whose quoted text is where it says', () => {
			const target = fileWith({ 11: 'const b = 3;', 12: 'const c = 4;' });
			assert.deepStrictEqual(reanchorLineRange({ start: 11, end: 12 }, quoted, target), { start: 11, end: 12 });
		});

		test('shifts a range to where its quoted text moved', () => {
			// Another part of the changes added two lines above, so the file has everything two lines lower
			const target = fileWith({ 13: 'const b = 3;', 14: 'const c = 4;' });
			assert.deepStrictEqual(reanchorLineRange({ start: 11, end: 12 }, quoted, target), { start: 13, end: 14 });
		});

		test('prefers the nearest occurrence', () => {
			const target = fileWith({ 2: 'const b = 3;', 9: 'const b = 3;' });
			assert.deepStrictEqual(reanchorLineRange({ start: 11, end: 11 }, quoted, target), { start: 9, end: 9 });
		});

		test('ignores trailing whitespace and carriage returns', () => {
			const target = fileWith({ 11: 'const b = 3;\r' });
			assert.deepStrictEqual(reanchorLineRange({ start: 11, end: 11 }, quoted, target), { start: 11, end: 11 });
		});

		test('anchors on the first non-blank quoted line', () => {
			const blankFirst = new Map([
				[5, ['']],
				[6, ['let total = 0;']],
			]);
			const target = fileWith({ 8: 'let total = 0;' });
			assert.deepStrictEqual(reanchorLineRange({ start: 5, end: 6 }, blankFirst, target), { start: 7, end: 8 });
		});

		test('returns undefined when the quoted text is gone', () => {
			assert.strictEqual(reanchorLineRange({ start: 11, end: 12 }, quoted, fileWith({})), undefined);
		});

		test('leaves a range it has nothing to check against', () => {
			assert.deepStrictEqual(reanchorLineRange({ start: 40, end: 42 }, quoted, fileWith({})), {
				start: 40,
				end: 42,
			});
		});
	});
});
