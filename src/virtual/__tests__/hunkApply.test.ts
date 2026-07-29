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

const noNewlineMarker = '\\ No newline at end of file';

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

	test('preserves CRLF line endings when the diff body omits the CR', () => {
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
				content: [' alpha', '-beta', noNewlineMarker, '+BETA', noNewlineMarker].join('\n'),
			},
		];
		const result = fromBytes(applyHunks(base, hunks));
		assert.strictEqual(result, 'alpha\nBETA');
	});

	test('throws on malformed hunk header', () => {
		assert.throws(() => applyHunks(toBytes('x\n'), [{ hunkHeader: 'NOT A HEADER', content: '' }]));
	});

	suite('base-relative application', () => {
		// A proposed compose commit receives an arbitrary subset of one combined diff's hunks, so the
		// line numbers of the hunks it did not receive must not shift the ones it did.
		test('applies a non-contiguous subset of a file’s hunks', () => {
			const base = toBytes(['a', 'b', 'c', 'd', 'e', 'f', ''].join('\n'));
			const hunks: ApplyableHunk[] = [
				{ hunkHeader: '@@ -1,1 +1,1 @@', content: ['-a', '+A'].join('\n') },
				{ hunkHeader: '@@ -5,1 +5,1 @@', content: ['-e', '+E'].join('\n') },
			];
			const result = fromBytes(applyHunks(base, hunks));
			assert.strictEqual(result, ['A', 'b', 'c', 'd', 'E', 'f', ''].join('\n'));
		});

		test('applies a hunk anchored where the previous hunk ended', () => {
			const base = toBytes(['a', 'b', 'c', ''].join('\n'));
			const hunks: ApplyableHunk[] = [
				{ hunkHeader: '@@ -1,1 +1,2 @@', content: [' a', '+X'].join('\n') },
				{ hunkHeader: '@@ -2,2 +3,2 @@', content: ['-b', '+B', ' c'].join('\n') },
			];
			const result = fromBytes(applyHunks(base, hunks));
			assert.strictEqual(result, ['a', 'X', 'B', 'c', ''].join('\n'));
		});

		test('throws when hunks are not ordered ascending by old-side start', () => {
			const base = toBytes(['a', 'b', 'c', 'd', ''].join('\n'));
			const hunks: ApplyableHunk[] = [
				{ hunkHeader: '@@ -3,1 +3,1 @@', content: ['-c', '+C'].join('\n') },
				{ hunkHeader: '@@ -1,1 +1,1 @@', content: ['-a', '+A'].join('\n') },
			];
			assert.throws(() => applyHunks(base, hunks), /ordered ascending/);
		});
	});

	suite('base verification', () => {
		test('throws when a context line does not match the base', () => {
			const base = toBytes(['one', 'two', ''].join('\n'));
			const hunks: ApplyableHunk[] = [
				{ hunkHeader: '@@ -1,2 +1,2 @@', content: [' MISMATCH', '-two', '+TWO'].join('\n') },
			];
			assert.throws(() => applyHunks(base, hunks), /does not match the base at line 1/);
		});

		test('throws when a deleted line does not match the base', () => {
			const base = toBytes(['one', 'two', ''].join('\n'));
			const hunks: ApplyableHunk[] = [
				{ hunkHeader: '@@ -1,2 +1,2 @@', content: [' one', '-MISMATCH', '+TWO'].join('\n') },
			];
			assert.throws(() => applyHunks(base, hunks), /does not match the base at line 2/);
		});

		test('throws when a hunk claims context past the end of the file', () => {
			const base = toBytes('only\n');
			const hunks: ApplyableHunk[] = [
				{ hunkHeader: '@@ -1,3 +1,3 @@', content: [' only', ' ghost', '-gone', '+new'].join('\n') },
			];
			assert.throws(() => applyHunks(base, hunks), /end of file/);
		});

		// An additions-only body has nothing to verify, so an out-of-range start would otherwise
		// collapse onto EOF and append silently instead of reporting the wrong base.
		test('throws when a hunk starts past the end of the base', () => {
			const base = toBytes('a\nb\n');
			const hunks: ApplyableHunk[] = [{ hunkHeader: '@@ -50,0 +50,1 @@', content: '+x' }];
			assert.throws(() => applyHunks(base, hunks), /starts past the end of the base/);
		});

		test('throws when a hunk starts one line past the end of the base', () => {
			const base = toBytes('a\nb\n');
			const hunks: ApplyableHunk[] = [{ hunkHeader: '@@ -4,0 +4,1 @@', content: '+x' }];
			assert.throws(() => applyHunks(base, hunks), /starts past the end of the base/);
		});

		test('appends when a hunk starts exactly at the end of the base', () => {
			const base = toBytes('a\nb\n');
			const hunks: ApplyableHunk[] = [{ hunkHeader: '@@ -3,0 +3,1 @@', content: '+x' }];
			const result = fromBytes(applyHunks(base, hunks));
			assert.strictEqual(result, 'a\nb\nx\n');
		});
	});

	suite('carriage returns', () => {
		// git emits the terminator's CR inside each body line of a CRLF file's diff, which is the
		// shape the other CRLF test above deliberately does not cover.
		test('preserves CRLF line endings when the diff body carries the CR', () => {
			const base = toBytes(['one', 'two', 'three', ''].join('\r\n'));
			const hunks: ApplyableHunk[] = [
				{ hunkHeader: '@@ -1,3 +1,3 @@', content: [' one\r', '-two\r', '+TWO\r', ' three\r'].join('\n') },
			];
			const result = fromBytes(applyHunks(base, hunks));
			assert.strictEqual(result, ['one', 'TWO', 'three', ''].join('\r\n'));
		});

		test('keeps a trailing CR that is genuine content when the base is not CRLF', () => {
			const base = toBytes('alpha\nbeta\r'); // unterminated last line whose content ends in CR
			const hunks: ApplyableHunk[] = [
				{
					hunkHeader: '@@ -1,2 +1,2 @@',
					content: [' alpha', '-beta\r', noNewlineMarker, '+BETA\r', noNewlineMarker].join('\n'),
				},
			];
			const result = fromBytes(applyHunks(base, hunks));
			assert.strictEqual(result, 'alpha\nBETA\r');
		});

		test('accepts a CRLF context line when the base is mostly LF', () => {
			const base = toBytes('a\r\nb\nc\n');
			const hunks: ApplyableHunk[] = [
				{ hunkHeader: '@@ -1,3 +1,3 @@', content: [' a\r', '-b', '+B', ' c'].join('\n') },
			];
			const result = fromBytes(applyHunks(base, hunks));
			assert.strictEqual(result, 'a\nB\nc\n');
		});

		test('matches an empty context line in a CRLF base', () => {
			const base = toBytes(['x', '', 'y', ''].join('\r\n'));
			const hunks: ApplyableHunk[] = [
				{ hunkHeader: '@@ -1,3 +1,3 @@', content: [' x\r', ' \r', '-y\r', '+Y\r'].join('\n') },
			];
			const result = fromBytes(applyHunks(base, hunks));
			assert.strictEqual(result, ['x', '', 'Y', ''].join('\r\n'));
		});
	});

	suite('no-newline-at-eof marker', () => {
		// The marker describes the line directly above it, so which side it belongs to decides
		// whether the result is terminated.
		test('keeps the trailing newline when only the old side lacked one', () => {
			const base = toBytes('line1\nlastline');
			const hunks: ApplyableHunk[] = [
				{
					hunkHeader: '@@ -1,2 +1,2 @@',
					content: [' line1', '-lastline', noNewlineMarker, '+newlast'].join('\n'),
				},
			];
			const result = fromBytes(applyHunks(base, hunks));
			assert.strictEqual(result, 'line1\nnewlast\n');
		});

		test('drops the trailing newline when the new side lacks one', () => {
			const base = toBytes('x\ny\n');
			const hunks: ApplyableHunk[] = [
				{ hunkHeader: '@@ -1,2 +1,2 @@', content: [' x', '-y', '+Y', noNewlineMarker].join('\n') },
			];
			const result = fromBytes(applyHunks(base, hunks));
			assert.strictEqual(result, 'x\nY');
		});

		test('keeps the surviving terminator when deleting the final unterminated line', () => {
			const base = toBytes('a\r\nb\r\nc');
			const hunks: ApplyableHunk[] = [
				{ hunkHeader: '@@ -2,2 +2,1 @@', content: [' b\r', '-c', noNewlineMarker].join('\n') },
			];
			const result = fromBytes(applyHunks(base, hunks));
			assert.strictEqual(result, 'a\r\nb\r\n');
		});

		test('honors the marker after a context line', () => {
			const base = toBytes('p\nq');
			const hunks: ApplyableHunk[] = [
				{ hunkHeader: '@@ -1,2 +1,2 @@', content: ['-p', '+P', ' q', noNewlineMarker].join('\n') },
			];
			const result = fromBytes(applyHunks(base, hunks));
			assert.strictEqual(result, 'P\nq');
		});

		// No marker is emitted for a region the diff never reached, so an unterminated base has to
		// carry its own ending forward rather than silently gaining a newline.
		test('leaves an unterminated base unterminated when the hunk stops short of EOF', () => {
			const base = toBytes('a\nb\nc');
			const hunks: ApplyableHunk[] = [{ hunkHeader: '@@ -1,1 +1,1 @@', content: ['-a', '+A'].join('\n') }];
			const result = fromBytes(applyHunks(base, hunks));
			assert.strictEqual(result, 'A\nb\nc');
		});

		test('leaves an unterminated CRLF base unterminated when the hunk stops short of EOF', () => {
			const base = toBytes('a\r\nb\r\nc');
			const hunks: ApplyableHunk[] = [{ hunkHeader: '@@ -1,1 +1,1 @@', content: ['-a\r', '+A\r'].join('\n') }];
			const result = fromBytes(applyHunks(base, hunks));
			assert.strictEqual(result, 'A\r\nb\r\nc');
		});

		test('keeps a terminated base terminated when the hunk stops short of EOF', () => {
			const base = toBytes('a\nb\nc\n');
			const hunks: ApplyableHunk[] = [{ hunkHeader: '@@ -1,1 +1,1 @@', content: ['-a', '+A'].join('\n') }];
			const result = fromBytes(applyHunks(base, hunks));
			assert.strictEqual(result, 'A\nb\nc\n');
		});

		test('emits no trailing newline for a file emptied by deletions', () => {
			const base = toBytes('a\nb\n');
			const hunks: ApplyableHunk[] = [{ hunkHeader: '@@ -1,2 +0,0 @@', content: ['-a', '-b'].join('\n') }];
			const result = fromBytes(applyHunks(base, hunks));
			assert.strictEqual(result, '');
		});
	});
});
