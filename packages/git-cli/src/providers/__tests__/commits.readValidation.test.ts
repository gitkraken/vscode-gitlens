import * as assert from 'assert';
import * as sinon from 'sinon';
import { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { GitResult } from '@gitlens/git/run.types.js';
import type { CliGitProviderInternal } from '../../cliGitProvider.js';
import type { Git } from '../../exec/git.js';
import { CommitsGitSubProvider } from '../commits.js';

const repoPath = '/repo';

function exited(stdout: string): GitResult {
	return { stdout: stdout, stderr: undefined, exitCode: 0, completion: { status: 'exited', code: 0 } };
}

/** Lets the pending microtasks and the reads they chain settle */
async function settle(): Promise<void> {
	for (let i = 0; i < 20; i++) {
		await Promise.resolve();
	}
}

suite('CommitsGitSubProvider — reads wait for the cache read validator', () => {
	let cache: Cache;
	let run: sinon.SinonStub;
	let provider: CommitsGitSubProvider;
	let release: () => void;

	setup(() => {
		cache = new Cache();
		run = sinon.stub().resolves(exited('3'));
		provider = new CommitsGitSubProvider(
			{} as unknown as GitServiceContext,
			{ run: run } as unknown as Git,
			cache,
			{} as unknown as CliGitProviderInternal,
		);

		const validation = new Promise<void>(resolve => {
			release = resolve;
		});
		cache.setReadValidator(() => validation);
	});

	teardown(() => {
		cache.dispose();
	});

	test('getCommitCount reads only once the validation settled', async () => {
		const count = provider.getCommitCount(repoPath, 'HEAD');
		await settle();
		assert.strictEqual(run.callCount, 0);

		release();
		assert.strictEqual(await count, 3);
		assert.strictEqual(run.callCount, 1);
	});

	test('getCommitReachability reads only once the validation settled', async () => {
		const reachability = provider.getCommitReachability(repoPath, 'abc');
		await settle();
		assert.strictEqual(run.callCount, 0);

		release();
		assert.deepStrictEqual(await reachability, { refs: [] });
		assert.strictEqual(run.callCount, 1);
	});
});
