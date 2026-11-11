import * as assert from 'assert';
import * as sinon from 'sinon';
import { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { CliGitProviderInternal } from '../../cliGitProvider.js';
import type { Git } from '../../exec/git.js';
import { BranchesGitSubProvider } from '../branches.js';

suite('BranchesGitSubProvider.getCurrentBranchReference with an unborn HEAD', () => {
	const repoPath = '/repo';

	let cache: Cache;
	let getConfigRegex: sinon.SinonStub;
	let branches: BranchesGitSubProvider;

	setup(() => {
		cache = new Cache();
		getConfigRegex = sinon.stub();

		// Every git read fails the way an unborn HEAD does, leaving only the configured default branch
		const run = sinon.stub().rejects(new Error("fatal: bad revision '@'"));
		branches = new BranchesGitSubProvider(
			{} as unknown as GitServiceContext,
			{ run: run } as unknown as Git,
			cache,
			{
				config: {
					getConfig: () => Promise.resolve(undefined),
					getConfigRegex: getConfigRegex,
				},
			} as unknown as CliGitProviderInternal,
		);
		sinon.stub(branches, 'getDefaultBranchName').resolves(undefined);
	});

	teardown(() => {
		sinon.restore();
		cache.dispose();
	});

	test('a failed config read answers the default branch without its upstream, and is not kept', async () => {
		getConfigRegex.onFirstCall().rejects(new Error('Unable to read the config keys'));
		getConfigRegex.onSecondCall().resolves(
			new Map([
				['branch.main.remote', 'origin'],
				['branch.main.merge', 'refs/heads/main'],
			]),
		);

		const failed = await branches.getCurrentBranchReference(repoPath);
		assert.strictEqual(failed?.name, 'main');
		assert.strictEqual(failed.upstream, undefined);

		const read = await branches.getCurrentBranchReference(repoPath);
		assert.strictEqual(read?.name, 'main');
		assert.strictEqual(read.upstream?.name, 'origin/main');
		assert.strictEqual(getConfigRegex.callCount, 2);
	});

	test('a read that matched nothing is kept', async () => {
		getConfigRegex.resolves(new Map());

		assert.strictEqual((await branches.getCurrentBranchReference(repoPath))?.name, 'main');
		assert.strictEqual((await branches.getCurrentBranchReference(repoPath))?.name, 'main');
		assert.strictEqual(getConfigRegex.callCount, 1);
	});
});
