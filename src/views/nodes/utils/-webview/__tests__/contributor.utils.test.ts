import * as assert from 'node:assert';
import { GitCommit, GitCommitIdentity } from '@gitlens/git/models/commit.js';
import type { GitFile } from '@gitlens/git/models/file.js';
import { GitFileChange } from '@gitlens/git/models/fileChange.js';
import { fileUri } from '@gitlens/utils/uri.js';
import { filterContributorFiles } from '../contributor.utils.js';

function createCommit(sha: string, files?: readonly GitFile[], parents: string[] = ['parent']): GitCommit {
	const identity = new GitCommitIdentity('Author', 'author@example.com', new Date(0));
	return new GitCommit('/repo', sha, identity, identity, 'Commit', parents, 'Commit', {
		files: files?.map(
			f => new GitFileChange('/repo', f.path, f.status, fileUri(`/repo/${f.path}`), f.originalPath),
		),
	});
}

suite('filterContributorFiles', () => {
	test('deduplicates repeated touches and retains the final comparison order, statuses, and stats', () => {
		const older = createCommit('older', [{ path: 'shared.ts', status: 'A' }]);
		const newer = createCommit('newer', [{ path: 'shared.ts', status: 'M' }], [older.sha]);
		const other = createCommit('other', [{ path: 'unrelated.ts', status: 'M' }], [newer.sha]);
		const shared: GitFile = {
			path: 'shared.ts',
			status: 'M',
			stats: { additions: 9, deletions: 4, changes: 13 },
		};
		const finalFiles: GitFile[] = [{ path: 'unrelated.ts', status: 'M' }, shared];

		const result = filterContributorFiles([newer, older], finalFiles, [other, newer, older]);

		assert.deepStrictEqual(result, [shared]);
		assert.strictEqual(result[0], shared);
	});

	test('includes a shared file even when another author made its latest change', () => {
		const authored = createCommit('authored', [{ path: 'shared.ts', status: 'M' }]);
		const other = createCommit('other', [{ path: 'shared.ts', status: 'M' }], [authored.sha]);
		const finalFiles: GitFile[] = [{ path: 'shared.ts', status: 'M' }];

		assert.deepStrictEqual(filterContributorFiles([authored], finalFiles, [other, authored]), finalFiles);
	});

	test('excludes reverted files that have no final difference', () => {
		const authored = createCommit('authored', [{ path: 'reverted.ts', status: 'M' }]);

		assert.deepStrictEqual(filterContributorFiles([authored], [], [authored]), []);
	});

	test('retains deletions and binary files without inventing stats', () => {
		const files: GitFile[] = [
			{ path: 'removed.ts', status: 'D' },
			{ path: 'image.png', status: 'M' },
		];
		const authored = createCommit('authored', files);

		assert.deepStrictEqual(filterContributorFiles([authored], files, [authored]), files);
	});

	test('follows rename chains through other authors and keeps the final rename', () => {
		const older = createCommit('older', [{ path: 'b.ts', originalPath: 'a.ts', status: 'R' }]);
		const authored = createCommit('authored', [{ path: 'c.ts', originalPath: 'b.ts', status: 'R' }], [older.sha]);
		const newer = createCommit('newer', [{ path: 'd.ts', originalPath: 'c.ts', status: 'R' }], [authored.sha]);
		const finalFiles: GitFile[] = [{ path: 'd.ts', originalPath: 'a.ts', status: 'R' }];

		assert.deepStrictEqual(filterContributorFiles([authored], finalFiles, [newer, authored, older]), finalFiles);
	});

	test('finds an earlier touch before another author renamed the file', () => {
		const authored = createCommit('authored', [{ path: 'old.ts', status: 'M' }]);
		const other = createCommit('other', [{ path: 'new.ts', originalPath: 'old.ts', status: 'R' }], [authored.sha]);
		const finalFiles: GitFile[] = [{ path: 'new.ts', originalPath: 'old.ts', status: 'R' }];

		assert.deepStrictEqual(filterContributorFiles([authored], finalFiles, [other, authored]), finalFiles);
	});

	test('does not attribute a copy to someone who only changed its source', () => {
		const authored = createCommit('authored', [{ path: 'source.ts', status: 'M' }]);
		const copy = createCommit(
			'copy',
			[{ path: 'copy.ts', originalPath: 'source.ts', status: 'C' }],
			[authored.sha],
		);
		const finalFiles: GitFile[] = [{ path: 'copy.ts', originalPath: 'source.ts', status: 'C' }];

		assert.deepStrictEqual(filterContributorFiles([authored], finalFiles, [copy, authored]), []);
		assert.deepStrictEqual(filterContributorFiles([copy], finalFiles, [copy, authored]), finalFiles);
	});

	test('does not connect a reused path to the file previously renamed away from it', () => {
		const authored = createCommit('authored', [{ path: 'old.ts', status: 'M' }]);
		const rename = createCommit(
			'rename',
			[{ path: 'new.ts', originalPath: 'old.ts', status: 'R' }],
			[authored.sha],
		);
		const recreate = createCommit('recreate', [{ path: 'old.ts', status: 'A' }], [rename.sha]);
		const finalFiles: GitFile[] = [
			{ path: 'old.ts', status: 'M' },
			{ path: 'new.ts', status: 'A' },
		];

		assert.deepStrictEqual(filterContributorFiles([authored], finalFiles, [recreate, rename, authored]), [
			finalFiles[1],
		]);
		assert.deepStrictEqual(filterContributorFiles([recreate], finalFiles, [recreate, rename, authored]), [
			finalFiles[0],
		]);
	});

	test('follows a working-tree rename without attributing the rename to a contributor', () => {
		const authored = createCommit('authored', [{ path: 'old.ts', status: 'M' }]);
		const unrelated = createCommit('unrelated', [{ path: 'other.ts', status: 'M' }], [authored.sha]);
		const files: GitFile[] = [{ path: 'new.ts', originalPath: 'old.ts', status: 'R' }];

		assert.deepStrictEqual(filterContributorFiles([authored], files, [unrelated, authored], files), files);
		assert.deepStrictEqual(filterContributorFiles([unrelated], files, [unrelated, authored], files), []);
	});

	test('traces a working-tree rename through earlier committed renames', () => {
		const authored = createCommit('authored', [{ path: 'original.ts', status: 'M' }]);
		const rename = createCommit(
			'rename',
			[{ path: 'committed.ts', originalPath: 'original.ts', status: 'R' }],
			[authored.sha],
		);
		const files: GitFile[] = [{ path: 'working.ts', originalPath: 'original.ts', status: 'R' }];
		const workingFiles: GitFile[] = [{ path: 'working.ts', originalPath: 'committed.ts', status: 'R' }];

		assert.deepStrictEqual(filterContributorFiles([authored], files, [rename, authored], workingFiles), files);
	});

	for (const status of ['A', '?'] as const) {
		test(`does not attribute a working-tree ${status === 'A' ? 'addition' : 'untracked file'} to an earlier deleted file`, () => {
			const authored = createCommit('authored', [{ path: 'reused.ts', status: 'D' }]);
			const files: GitFile[] = [{ path: 'reused.ts', status: 'M' }];
			const workingFiles: GitFile[] = [{ path: 'reused.ts', status: status }];

			assert.deepStrictEqual(filterContributorFiles([authored], files, [authored], workingFiles), []);
		});
	}

	test('does not attribute a working-tree copy to the contributor who changed its source', () => {
		const authored = createCommit('authored', [{ path: 'source.ts', status: 'M' }]);
		const files: GitFile[] = [{ path: 'copy.ts', originalPath: 'source.ts', status: 'C' }];

		assert.deepStrictEqual(filterContributorFiles([authored], files, [authored], files), []);
	});

	test('keeps committed touches when the working tree modifies or deletes their file', () => {
		const authored = createCommit('authored', [{ path: 'file.ts', status: 'M' }]);
		for (const status of ['M', 'D'] as const) {
			const files: GitFile[] = [{ path: 'file.ts', status: status }];

			assert.deepStrictEqual(filterContributorFiles([authored], files, [authored], files), files);
		}
	});

	test('includes both authors who independently added the same path on merged branches', () => {
		const file: GitFile = { path: 'shared.ts', status: 'A' };
		const alice = createCommit('alice', [file], ['base']);
		const bob = createCommit('bob', [file], ['base']);
		const merge = createCommit('merge', [file], [alice.sha, bob.sha]);
		const history = [merge, alice, bob];

		assert.deepStrictEqual(filterContributorFiles([alice], [file], history), [file]);
		assert.deepStrictEqual(filterContributorFiles([bob], [file], history), [file]);
		assert.deepStrictEqual(filterContributorFiles([merge], [file], history), []);
	});

	test('follows renames on each merge parent regardless of history iteration order', () => {
		const alice = createCommit('alice', [{ path: 'before.ts', status: 'M' }]);
		const rename = createCommit(
			'rename',
			[{ path: 'after.ts', originalPath: 'before.ts', status: 'R' }],
			[alice.sha],
		);
		const bob = createCommit('bob', [{ path: 'after.ts', status: 'A' }]);
		const merge = createCommit('merge', undefined, [rename.sha, bob.sha]);
		const file: GitFile = { path: 'after.ts', status: 'M' };

		assert.deepStrictEqual(filterContributorFiles([alice], [file], [alice, bob, merge, rename]), [file]);
		assert.deepStrictEqual(filterContributorFiles([bob], [file], [alice, bob, merge, rename]), [file]);
	});

	test('excludes merge imports even when merge file details were loaded', () => {
		const files: GitFile[] = [{ path: 'imported.ts', status: 'A' }];
		const merge = createCommit('merge', files, ['parent1', 'parent2']);

		assert.deepStrictEqual(filterContributorFiles([merge], files, [merge]), []);
	});

	test('ignores unavailable commit details rather than treating filtered files as complete', () => {
		const authored = createCommit('authored');
		const files: GitFile[] = [{ path: 'unknown.ts', status: 'M' }];

		assert.deepStrictEqual(filterContributorFiles([authored], files, [authored]), []);
	});

	test('supports single-use iterables and an empty contributor history', () => {
		const files: GitFile[] = [{ path: 'file.ts', status: 'M' }];
		const authored = createCommit('authored', files);

		assert.deepStrictEqual(filterContributorFiles([authored].values(), files, [authored].values()), files);
		assert.deepStrictEqual(filterContributorFiles([], files, [authored]), []);
	});
});
