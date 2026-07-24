import * as assert from 'assert';
import { parseGitWorktrees } from '../worktreeParser.js';

/** Builds `git worktree list --porcelain` output, which delimits each worktree with an empty line */
function buildPorcelain(...entries: string[]): string {
	return `${entries.join('\n\n')}\n\n`;
}

const mainWorktree = 'worktree /repo\nHEAD 1111111111111111111111111111111111111111\nbranch refs/heads/main';

suite('Worktree Parser Test Suite', () => {
	suite('parseGitWorktrees', () => {
		test('parses a locked worktree with a single-word lock reason', () => {
			const data = buildPorcelain(
				mainWorktree,
				'worktree /repo/wt\nHEAD 2222222222222222222222222222222222222222\nbranch refs/heads/wt\nlocked kepler:task:cb600cca-949d-4dd4-8148-3d48da0079f8',
			);

			const worktrees = parseGitWorktrees(data, '/repo', []);

			assert.strictEqual(worktrees.length, 2);
			assert.strictEqual(worktrees[1].locked, 'kepler:task:cb600cca-949d-4dd4-8148-3d48da0079f8');
		});

		test('parses a locked worktree with a multi-word lock reason', () => {
			const data = buildPorcelain(
				mainWorktree,
				'worktree /repo/wt\nHEAD 2222222222222222222222222222222222222222\nbranch refs/heads/wt\nlocked in use by CI',
			);

			const worktrees = parseGitWorktrees(data, '/repo', []);

			assert.strictEqual(worktrees[1].locked, 'in use by CI');
		});

		test('parses a locked worktree with no lock reason', () => {
			const data = buildPorcelain(
				mainWorktree,
				'worktree /repo/wt\nHEAD 2222222222222222222222222222222222222222\nbranch refs/heads/wt\nlocked',
			);

			const worktrees = parseGitWorktrees(data, '/repo', []);

			assert.strictEqual(worktrees[1].locked, true);
		});

		test('parses an unlocked worktree', () => {
			const data = buildPorcelain(
				mainWorktree,
				'worktree /repo/wt\nHEAD 2222222222222222222222222222222222222222\nbranch refs/heads/wt',
			);

			const worktrees = parseGitWorktrees(data, '/repo', []);

			assert.strictEqual(worktrees[1].locked, false);
		});

		test('parses a prunable worktree, keeping the whole reason', () => {
			const data = buildPorcelain(
				mainWorktree,
				'worktree /repo/wt\nHEAD 2222222222222222222222222222222222222222\ndetached\nprunable gitdir file points to non-existent location',
			);

			const worktrees = parseGitWorktrees(data, '/repo', []);

			assert.strictEqual(worktrees[1].prunable, 'gitdir file points to non-existent location');
		});
	});
});
