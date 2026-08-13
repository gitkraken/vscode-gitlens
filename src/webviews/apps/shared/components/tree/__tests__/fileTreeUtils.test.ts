import * as assert from 'assert';
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import type { GitFileStatus } from '@gitlens/git/models/fileStatus.js';
import { selectFilesByPath, selectRowsByPath } from '../file-tree-utils.js';

function file(path: string, staged: boolean, status: GitFileStatus = 'M'): GitFileChangeShape {
	return { path: path, repoPath: '/repo', status: status, staged: staged };
}

suite('tree/file-tree-utils', () => {
	suite('selectFilesByPath', () => {
		test('keeps a mixed path once, not once per row', () => {
			// The working-changes feed emits BOTH halves of a mixed file as separate rows sharing one
			// path. Counting them twice turned the toolbar chips' multi-selection behavior on for a
			// single selected file, and handed Stash/Copy the same path twice.
			const files = [file('mixed.txt', true), file('mixed.txt', false)];

			const result = selectFilesByPath(files, new Set(['mixed.txt']));

			assert.strictEqual(result.length, 1, 'one selected mixed row resolves to one file');
			assert.strictEqual(result[0].path, 'mixed.txt');
		});

		test('keeps the first row for a duplicated path', () => {
			const first = file('mixed.txt', true);
			const files = [first, file('mixed.txt', false)];

			assert.strictEqual(selectFilesByPath(files, new Set(['mixed.txt']))[0], first);
		});

		test('returns only the selected paths, in file order', () => {
			const files = [file('a.txt', false), file('b.txt', false), file('c.txt', false)];

			const result = selectFilesByPath(files, new Set(['c.txt', 'a.txt']));

			assert.deepStrictEqual(
				result.map(f => f.path),
				['a.txt', 'c.txt'],
			);
		});

		test('a selected path with no matching file drops out', () => {
			const result = selectFilesByPath([file('a.txt', false)], new Set(['a.txt', 'gone.txt']));

			assert.deepStrictEqual(
				result.map(f => f.path),
				['a.txt'],
			);
		});

		test('an empty selection and an absent file list both resolve to nothing', () => {
			assert.deepStrictEqual(selectFilesByPath([file('a.txt', false)], new Set()), []);
			assert.deepStrictEqual(selectFilesByPath(undefined, new Set(['a.txt'])), []);
		});
	});

	suite('selectRowsByPath', () => {
		test('keeps BOTH rows of a mixed path', () => {
			// Each row is its own diff — `openWipMultipleChanges` routes staged to HEAD↔index and
			// unstaged to index↔working — so de-duping here would open only the staged half.
			const staged = file('mixed.txt', true);
			const unstaged = file('mixed.txt', false);

			const result = selectRowsByPath([staged, unstaged], new Set(['mixed.txt']));

			assert.deepStrictEqual(result, [staged, unstaged]);
		});

		test('differs from selectFilesByPath only in de-duping', () => {
			const files = [file('mixed.txt', true), file('mixed.txt', false), file('plain.txt', false)];
			const selected = new Set(['mixed.txt', 'plain.txt']);

			assert.strictEqual(selectRowsByPath(files, selected).length, 3, 'rows');
			assert.strictEqual(selectFilesByPath(files, selected).length, 2, 'files');
		});
	});
});
