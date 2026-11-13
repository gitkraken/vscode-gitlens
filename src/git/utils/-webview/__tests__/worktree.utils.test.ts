import * as assert from 'assert';
import * as sinon from 'sinon';
import type { GitWorktree } from '@gitlens/git/models/worktree.js';
import type { GlRepository } from '../../../models/repository.js';
import { getWorktreesByBranch } from '../worktree.utils.js';

suite('git/-webview/worktree.utils', () => {
	suite('getWorktreesByBranch', () => {
		const worktree = {
			type: 'branch',
			path: '/repo-feature',
			sha: 'aaa',
			branch: { id: 'branch-feature', name: 'feature' },
			isDefault: false,
		} as unknown as GitWorktree;

		function repoOf(supportsWorktrees: boolean, getWorktrees: sinon.SinonStub): GlRepository {
			return {
				git: {
					supports: sinon.stub().resolves(supportsWorktrees),
					worktrees: { getWorktrees: getWorktrees },
				},
			} as unknown as GlRepository;
		}

		test('maps worktrees by branch when git supports worktrees', async () => {
			const getWorktrees = sinon.stub().resolves([worktree]);

			const result = await getWorktreesByBranch(repoOf(true, getWorktrees));

			assert.strictEqual(result.get('branch-feature'), worktree);
		});

		// #4363: `getWorktrees` throws on a git older than 2.17, which left the Commit Graph blank
		test('returns an empty map without reading worktrees when git lacks worktree support', async () => {
			const getWorktrees = sinon
				.stub()
				.rejects(new Error('Displaying worktrees requires a newer version of Git'));

			const result = await getWorktreesByBranch(repoOf(false, getWorktrees));

			assert.strictEqual(result.size, 0);
			assert.strictEqual(getWorktrees.callCount, 0);
		});
	});
});
