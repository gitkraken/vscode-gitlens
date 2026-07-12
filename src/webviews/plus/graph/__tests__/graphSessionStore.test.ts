import * as assert from 'assert';
import { Uri } from 'vscode';
import type { GitDir } from '@gitlens/git/models/repository.js';
import { fnv1aHash64 } from '@gitlens/utils/hash.js';
import { getGraphSessionSnapshotUris } from '../graphSessionStore.js';

suite('graphSessionStore', () => {
	suite('getGraphSessionSnapshotUris', () => {
		test('maps a main worktree to its own git dir + a key hashed from the repo path', () => {
			const repoPath = '/repos/acme';
			const gitDir: GitDir = { uri: Uri.file('/repos/acme/.git') };

			const { dir, file } = getGraphSessionSnapshotUris(gitDir, repoPath);

			assert.strictEqual(dir.fsPath, Uri.file('/repos/acme/.git/gitlens/graph').fsPath);
			assert.strictEqual(
				file.fsPath,
				Uri.file(`/repos/acme/.git/gitlens/graph/session-${fnv1aHash64(repoPath)}.json`).fsPath,
			);
		});

		test('maps a linked worktree to the COMMON git dir, keyed by the worktree root path', () => {
			const worktreePath = '/repos/acme-wt';
			const gitDir: GitDir = {
				uri: Uri.file('/repos/acme/.git/worktrees/acme-wt'),
				commonUri: Uri.file('/repos/acme/.git'),
			};

			const { dir, file } = getGraphSessionSnapshotUris(gitDir, worktreePath);

			// Directory follows the common dir (shared across worktrees), not this worktree's own git dir.
			assert.strictEqual(dir.fsPath, Uri.file('/repos/acme/.git/gitlens/graph').fsPath);
			assert.strictEqual(
				file.fsPath,
				Uri.file(`/repos/acme/.git/gitlens/graph/session-${fnv1aHash64(worktreePath)}.json`).fsPath,
			);
		});

		test('two worktrees sharing a common git dir get distinct files in the same directory', () => {
			const commonUri = Uri.file('/repos/acme/.git');
			const main = getGraphSessionSnapshotUris({ uri: commonUri }, '/repos/acme');
			const worktree = getGraphSessionSnapshotUris(
				{ uri: Uri.file('/repos/acme/.git/worktrees/wt'), commonUri: commonUri },
				'/repos/acme-wt',
			);

			assert.strictEqual(main.dir.fsPath, worktree.dir.fsPath);
			assert.notStrictEqual(main.file.fsPath, worktree.file.fsPath);
		});

		test('is deterministic for a given worktree root path', () => {
			const gitDir: GitDir = { uri: Uri.file('/repos/acme/.git') };
			assert.strictEqual(
				getGraphSessionSnapshotUris(gitDir, '/repos/acme').file.fsPath,
				getGraphSessionSnapshotUris(gitDir, '/repos/acme').file.fsPath,
			);
		});
	});
});
