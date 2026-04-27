import * as assert from 'assert';
import type { ApplyableHunk } from '../hunkApply.js';
import { applyHunks } from '../hunkApply.js';

const utf8 = new TextEncoder();
const decoder = new TextDecoder();

function toBytes(text: string): Uint8Array {
	return utf8.encode(text);
}

function fromBytes(bytes: Uint8Array): string {
	return decoder.decode(bytes);
}

suite('applyHunks Test Suite', () => {
	test('applies a single modification hunk', () => {
		const base = toBytes(['one', 'two', 'three', 'four', 'five', ''].join('\n'));
		const hunks: ApplyableHunk[] = [
			{
				hunkHeader: '@@ -2,3 +2,3 @@',
				content: [' two', '-three', '+THREE', ' four'].join('\n'),
			},
		];
		const result = fromBytes(applyHunks(base, hunks));
		assert.strictEqual(result, ['one', 'two', 'THREE', 'four', 'five', ''].join('\n'));
	});

	test('applies multiple hunks in one file', () => {
		const base = toBytes(['a', 'b', 'c', 'd', 'e', 'f', 'g', ''].join('\n'));
		const hunks: ApplyableHunk[] = [
			{ hunkHeader: '@@ -1,2 +1,2 @@', content: [' a', '-b', '+B'].join('\n') },
			{ hunkHeader: '@@ -5,3 +5,3 @@', content: [' e', '-f', '+F', ' g'].join('\n') },
		];
		const result = fromBytes(applyHunks(base, hunks));
		assert.strictEqual(result, ['a', 'B', 'c', 'd', 'e', 'F', 'g', ''].join('\n'));
	});

	test('inserts lines (addition-only hunk)', () => {
		const base = toBytes(['keep1', 'keep2', ''].join('\n'));
		const hunks: ApplyableHunk[] = [
			{
				hunkHeader: '@@ -1,2 +1,4 @@',
				content: [' keep1', '+added1', '+added2', ' keep2'].join('\n'),
			},
		];
		const result = fromBytes(applyHunks(base, hunks));
		assert.strictEqual(result, ['keep1', 'added1', 'added2', 'keep2', ''].join('\n'));
	});

	test('deletes lines (deletion-only hunk)', () => {
		const base = toBytes(['keep', 'gone1', 'gone2', 'keep', ''].join('\n'));
		const hunks: ApplyableHunk[] = [
			{
				hunkHeader: '@@ -1,4 +1,2 @@',
				content: [' keep', '-gone1', '-gone2', ' keep'].join('\n'),
			},
		];
		const result = fromBytes(applyHunks(base, hunks));
		assert.strictEqual(result, ['keep', 'keep', ''].join('\n'));
	});

	test('treats undefined base as new-file add', () => {
		const hunks: ApplyableHunk[] = [
			{ hunkHeader: '@@ -0,0 +1,3 @@', content: ['+first', '+second', '+third'].join('\n') },
		];
		const result = fromBytes(applyHunks(undefined, hunks));
		assert.strictEqual(result, ['first', 'second', 'third', ''].join('\n'));
	});

	test('returns base unchanged for a pure rename', () => {
		const base = toBytes('hello world\n');
		const hunks: ApplyableHunk[] = [{ hunkHeader: '@@ @@', content: '', isRename: true }];
		const result = fromBytes(applyHunks(base, hunks));
		assert.strictEqual(result, 'hello world\n');
	});

	test('preserves CRLF line endings when base uses CRLF', () => {
		const base = toBytes(['one', 'two', 'three', ''].join('\r\n'));
		const hunks: ApplyableHunk[] = [
			{ hunkHeader: '@@ -1,3 +1,3 @@', content: [' one', '-two', '+TWO', ' three'].join('\n') },
		];
		const result = fromBytes(applyHunks(base, hunks));
		assert.strictEqual(result, ['one', 'TWO', 'three', ''].join('\r\n'));
	});

	test('honors "no newline at end of file" marker', () => {
		const base = toBytes('alpha\nbeta'); // no trailing newline
		const hunks: ApplyableHunk[] = [
			{
				hunkHeader: '@@ -1,2 +1,2 @@',
				content: [
					' alpha',
					'-beta',
					'\\ No newline at end of file',
					'+BETA',
					'\\ No newline at end of file',
				].join('\n'),
			},
		];
		const result = fromBytes(applyHunks(base, hunks));
		assert.strictEqual(result, 'alpha\nBETA');
	});

	test('throws on malformed hunk header', () => {
		assert.throws(() => applyHunks(toBytes('x\n'), [{ hunkHeader: 'NOT A HEADER', content: '' }]));
	});
});
