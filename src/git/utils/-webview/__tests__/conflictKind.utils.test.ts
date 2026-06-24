import * as assert from 'assert';
import type { GitFile } from '@gitlens/git/models/file.js';
import type { GitFileConflictStatus } from '@gitlens/git/models/fileStatus.js';
import type { GitConflictFile } from '@gitlens/git/models/staging.js';
import { detectRename } from '../conflictKind.utils.js';

function conflictFile(path: string, status: GitFileConflictStatus): GitConflictFile {
	const file: GitConflictFile = { path: path, repoPath: '/repo', status: status, conflictStatus: status };
	return file;
}

function renamed(originalPath: string, path: string): GitFile {
	return { path: path, originalPath: originalPath, status: 'R' };
}

function deleted(path: string): GitFile {
	return { path: path, status: 'D' };
}

function modified(path: string): GitFile {
	return { path: path, status: 'M' };
}

suite('git/-webview/conflictKind.utils', () => {
	suite('detectRename', () => {
		test('rename/rename — both sides rename the original to different targets', () => {
			// ours-renamed.txt is added-by-us (AU); ours renamed orig→ours-renamed, theirs renamed orig→theirs-renamed.
			const result = detectRename(
				conflictFile('ours-renamed.txt', 'AU'),
				[renamed('orig.txt', 'ours-renamed.txt')],
				[renamed('orig.txt', 'theirs-renamed.txt')],
			);
			assert.deepStrictEqual(result, {
				kind: 'rename-rename',
				renameOf: 'orig.txt',
				renamePairPath: 'theirs-renamed.txt',
			});
		});

		test('rename/delete — one side renames, the other deletes (UD)', () => {
			const result = detectRename(
				conflictFile('ours-kept.txt', 'UD'),
				[renamed('orig.txt', 'ours-kept.txt')],
				[deleted('orig.txt')],
			);
			assert.deepStrictEqual(result, { kind: 'rename-delete', renameOf: 'orig.txt' });
		});

		test('rename+modify — one side renames, the other modifies content (UU)', () => {
			const result = detectRename(
				conflictFile('all-renamed.txt', 'UU'),
				[renamed('all-rename-modify.txt', 'all-renamed.txt')],
				[modified('all-rename-modify.txt')],
			);
			assert.deepStrictEqual(result, { kind: 'rename-modify', renameOf: 'all-rename-modify.txt' });
		});

		test('no rename — plain content conflict returns undefined', () => {
			const result = detectRename(conflictFile('file.txt', 'UU'), [modified('file.txt')], [modified('file.txt')]);
			assert.strictEqual(result, undefined);
		});

		test('returns undefined when no diff data is available', () => {
			assert.strictEqual(detectRename(conflictFile('file.txt', 'UU'), undefined, undefined), undefined);
		});
	});
});
