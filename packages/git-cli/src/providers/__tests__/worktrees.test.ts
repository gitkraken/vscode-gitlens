import * as assert from 'assert';
import * as sinon from 'sinon';
import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { GitResult } from '@gitlens/git/run.types.js';
import type { CliGitProviderInternal } from '../../cliGitProvider.js';
import type { Git } from '../../exec/git.js';
import { WorktreesGitSubProvider } from '../worktrees.js';

function exited(stdout: string): GitResult {
	return { stdout: stdout, stderr: undefined, exitCode: 0, completion: { status: 'exited', code: 0 } };
}

function failed(): GitResult {
	return {
		stdout: '',
		stderr: undefined,
		completion: { status: 'failed', reason: 'unstarted', error: new Error('spawn failed') },
	};
}

suite('WorktreesGitSubProvider.pruneWorktrees', () => {
	const repoPath = '/repo';
	const listing =
		'worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /wt\nHEAD def\nbranch refs/heads/side\n';

	let run: sinon.SinonStub;
	let unregisterRepoPath: sinon.SinonSpy;
	let provider: WorktreesGitSubProvider;

	setup(() => {
		run = sinon.stub();
		const git = { ensureSupports: () => Promise.resolve(), run: run } as unknown as Git;
		unregisterRepoPath = sinon.spy();
		const cache = { unregisterRepoPath: unregisterRepoPath } as unknown as Cache;
		provider = new WorktreesGitSubProvider(
			{ hooks: {} } as unknown as GitServiceContext,
			git,
			cache,
			{} as unknown as CliGitProviderInternal,
		);
	});

	test('unregisters a worktree the prune removed', async () => {
		run.onCall(0).resolves(exited(listing));
		run.onCall(1).resolves(exited(''));
		run.onCall(2).resolves(exited('worktree /repo\nHEAD abc\nbranch refs/heads/main\n'));

		await provider.pruneWorktrees(repoPath);

		sinon.assert.calledOnceWithExactly(unregisterRepoPath, '/wt');
	});

	test('a failed listing after the prune unregisters nothing', async () => {
		run.onCall(0).resolves(exited(listing));
		run.onCall(1).resolves(exited(''));
		run.onCall(2).resolves(failed());

		await provider.pruneWorktrees(repoPath);

		sinon.assert.notCalled(unregisterRepoPath);
	});
});
