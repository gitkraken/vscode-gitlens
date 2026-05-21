import * as assert from 'assert';
import { applyResolutions, parseConflictHunks } from '../conflictHunks.utils.js';

suite('conflictHunks.utils', () => {
	suite('parseConflictHunks', () => {
		test('parses a single 2-way conflict', () => {
			const text =
				'one\n' +
				'<<<<<<< HEAD\n' +
				'ours-a\n' +
				'ours-b\n' +
				'=======\n' +
				'theirs-a\n' +
				'>>>>>>> feature\n' +
				'two\n';
			const result = parseConflictHunks(text);
			assert.strictEqual(result.unbalanced, false);
			assert.strictEqual(result.hasDiff3, false);
			assert.strictEqual(result.hunks.length, 1);
			assert.strictEqual(result.eol, '\n');

			const h = result.hunks[0];
			assert.strictEqual(h.index, 0);
			assert.strictEqual(h.startLine, 1);
			assert.strictEqual(h.endLine, 6);
			assert.strictEqual(h.currentLabel, 'HEAD');
			assert.strictEqual(h.incomingLabel, 'feature');
			assert.deepStrictEqual(h.current.lines, ['ours-a', 'ours-b']);
			assert.deepStrictEqual(h.incoming.lines, ['theirs-a']);
			assert.strictEqual(h.base, undefined);
		});

		test('parses a single 3-way (diff3) conflict', () => {
			const text =
				'<<<<<<< HEAD\n' +
				'ours\n' +
				'||||||| merged common ancestors\n' +
				'base-a\n' +
				'base-b\n' +
				'=======\n' +
				'theirs\n' +
				'>>>>>>> feature\n';
			const result = parseConflictHunks(text);
			assert.strictEqual(result.unbalanced, false);
			assert.strictEqual(result.hasDiff3, true);
			assert.strictEqual(result.hunks.length, 1);

			const h = result.hunks[0];
			assert.strictEqual(h.baseLabel, 'merged common ancestors');
			assert.deepStrictEqual(h.current.lines, ['ours']);
			assert.deepStrictEqual(h.base?.lines, ['base-a', 'base-b']);
			assert.deepStrictEqual(h.incoming.lines, ['theirs']);
		});

		test('parses multiple sequential conflicts and assigns sequential indices', () => {
			const text = [
				'<<<<<<< HEAD',
				'A',
				'=======',
				'B',
				'>>>>>>> a',
				'middle',
				'<<<<<<< HEAD',
				'C',
				'=======',
				'D',
				'>>>>>>> b',
				'',
			].join('\n');
			const result = parseConflictHunks(text);
			assert.strictEqual(result.unbalanced, false);
			assert.strictEqual(result.hunks.length, 2);
			assert.strictEqual(result.hunks[0].index, 0);
			assert.strictEqual(result.hunks[1].index, 1);
			assert.strictEqual(result.hunks[1].incomingLabel, 'b');
		});

		test('handles empty current and incoming regions', () => {
			const text = '<<<<<<< HEAD\n=======\n>>>>>>> feature\n';
			const result = parseConflictHunks(text);
			assert.strictEqual(result.hunks.length, 1);
			assert.deepStrictEqual(result.hunks[0].current.lines, []);
			assert.deepStrictEqual(result.hunks[0].incoming.lines, []);
		});

		test('handles markers without labels', () => {
			const text = '<<<<<<<\nA\n=======\nB\n>>>>>>>\n';
			const result = parseConflictHunks(text);
			assert.strictEqual(result.unbalanced, false);
			assert.strictEqual(result.hunks.length, 1);
			assert.strictEqual(result.hunks[0].currentLabel, '');
			assert.strictEqual(result.hunks[0].incomingLabel, '');
		});

		test('detects CRLF line endings and preserves content', () => {
			const text = '<<<<<<< HEAD\r\nA\r\n=======\r\nB\r\n>>>>>>> feature\r\n';
			const result = parseConflictHunks(text);
			assert.strictEqual(result.eol, '\r\n');
			assert.strictEqual(result.hunks.length, 1);
			assert.deepStrictEqual(result.hunks[0].current.lines, ['A']);
			assert.deepStrictEqual(result.hunks[0].incoming.lines, ['B']);
		});

		test('handles conflict at end of file with no trailing newline', () => {
			const text = '<<<<<<< HEAD\nA\n=======\nB\n>>>>>>> feature';
			const result = parseConflictHunks(text);
			assert.strictEqual(result.hunks.length, 1);
			assert.strictEqual(result.hunks[0].endLine, 4);
		});

		test('flags unbalanced when a start marker is missing its separator', () => {
			const text = '<<<<<<< HEAD\nstuff\nstuff\n';
			const result = parseConflictHunks(text);
			assert.strictEqual(result.unbalanced, true);
			assert.strictEqual(result.hunks.length, 0);
		});

		test('flags unbalanced when a separator is missing its end marker', () => {
			const text = '<<<<<<< HEAD\nA\n=======\nB\n';
			const result = parseConflictHunks(text);
			assert.strictEqual(result.unbalanced, true);
			assert.strictEqual(result.hunks.length, 0);
		});

		test('ignores indented or partial markers (not at start of line)', () => {
			const text = '  <<<<<<< HEAD\nx\n  =======\ny\n  >>>>>>> branch\n';
			const result = parseConflictHunks(text);
			assert.strictEqual(result.hunks.length, 0);
			assert.strictEqual(result.unbalanced, false);
		});

		test('does not falsely match lines starting with more than 7 markers', () => {
			const text = '<<<<<<<<<<<<<<< not a marker\nfoo\n';
			const result = parseConflictHunks(text);
			assert.strictEqual(result.hunks.length, 0);
			assert.strictEqual(result.unbalanced, false);
		});

		test('returns empty hunks list for input without any markers', () => {
			const text = 'line1\nline2\nline3\n';
			const result = parseConflictHunks(text);
			assert.strictEqual(result.hunks.length, 0);
			assert.strictEqual(result.unbalanced, false);
			assert.strictEqual(result.hasDiff3, false);
		});
	});

	suite('applyResolutions', () => {
		test('replaces a single hunk with the supplied resolution', () => {
			const text = 'pre\n<<<<<<< HEAD\nA\n=======\nB\n>>>>>>> feature\npost\n';
			const parsed = parseConflictHunks(text);
			const result = applyResolutions(parsed, new Map([[0, ['merged']]]));
			assert.strictEqual(result, 'pre\nmerged\npost');
		});

		test('preserves hunks without a resolution', () => {
			const text = [
				'<<<<<<< HEAD',
				'A',
				'=======',
				'B',
				'>>>>>>> a',
				'<<<<<<< HEAD',
				'C',
				'=======',
				'D',
				'>>>>>>> b',
				'',
			].join('\n');
			const parsed = parseConflictHunks(text);
			const result = applyResolutions(parsed, new Map([[0, ['resolved-a']]]));
			assert.strictEqual(result, 'resolved-a\n<<<<<<< HEAD\nC\n=======\nD\n>>>>>>> b');
		});

		test('preserves CRLF line endings on rewrite', () => {
			const text = 'pre\r\n<<<<<<< HEAD\r\nA\r\n=======\r\nB\r\n>>>>>>> feature\r\npost\r\n';
			const parsed = parseConflictHunks(text);
			const result = applyResolutions(parsed, new Map([[0, ['merged']]]));
			assert.strictEqual(result, 'pre\r\nmerged\r\npost');
		});

		test('handles a resolution that empties a hunk', () => {
			const text = 'pre\n<<<<<<< HEAD\nA\n=======\nB\n>>>>>>> feature\npost\n';
			const parsed = parseConflictHunks(text);
			const result = applyResolutions(parsed, new Map([[0, []]]));
			assert.strictEqual(result, 'pre\npost');
		});
	});
});
