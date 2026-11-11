import * as assert from 'assert';
import * as sinon from 'sinon';
import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { CliGitProviderInternal } from '../../cliGitProvider.js';
import type { Git } from '../../exec/git.js';
import { OperationsGitSubProvider } from '../operations.js';

suite('OperationsGitSubProvider.followRemoteHeads', () => {
	const repoPath = '/repo';

	let getConfigRegex: sinon.SinonStub;
	let setRemoteHeadIfMissing: sinon.SinonStub;
	let operations: OperationsGitSubProvider;

	setup(() => {
		getConfigRegex = sinon.stub();
		setRemoteHeadIfMissing = sinon.stub().resolves();

		operations = new OperationsGitSubProvider(
			{} as unknown as GitServiceContext,
			{ supports: () => Promise.resolve(false) } as unknown as Git,
			{ getCommonPath: (path: string) => path } as unknown as Cache,
			{
				config: { getConfigRegex: getConfigRegex },
				remotes: { getRemotes: () => Promise.resolve([{ name: 'origin' }]) },
				branches: { setRemoteHeadIfMissing: setRemoteHeadIfMissing },
			} as unknown as CliGitProviderInternal,
		);
	});

	teardown(() => {
		sinon.restore();
	});

	function follow(fetched: 'all' | 'default' | { remote: string }): Promise<void> {
		return (operations as unknown as { followRemoteHeads(p: string, f: unknown): Promise<void> }).followRemoteHeads(
			repoPath,
			fetched,
		);
	}

	test('a failed config read writes nothing and leaves the remotes to a later fetch', async () => {
		getConfigRegex.onFirstCall().rejects(new Error('Unable to read the config keys'));
		getConfigRegex.onSecondCall().resolves(new Map());

		await follow('all');
		sinon.assert.notCalled(setRemoteHeadIfMissing);

		await follow('all');
		sinon.assert.calledOnceWithExactly(setRemoteHeadIfMissing, repoPath, 'origin');
	});

	test('a remote is written once', async () => {
		getConfigRegex.resolves(new Map());

		await follow({ remote: 'origin' });
		await follow({ remote: 'origin' });

		sinon.assert.calledOnce(setRemoteHeadIfMissing);
	});
});
