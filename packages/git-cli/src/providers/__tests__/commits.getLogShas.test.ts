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

suite('CommitsGitSubProvider.getLogShas — excluding', () => {
	let cache: Cache;
	let run: sinon.SinonStub;
	let provider: CommitsGitSubProvider;

	setup(() => {
		cache = new Cache();
		run = sinon.stub().resolves(exited(''));
		const git = { run: run } as unknown as Git;
		provider = new CommitsGitSubProvider(
			{} as unknown as GitServiceContext,
			git,
			cache,
			{} as unknown as CliGitProviderInternal,
		);
	});

	teardown(() => {
		cache.dispose();
	});

	function argv(call = 0): string[] {
		return (run.getCall(call).args as unknown[]).slice(1).filter((a): a is string => typeof a === 'string');
	}

	test('excluding lands after the rev and before --', async () => {
		await provider.getLogShas(repoPath, 'feat', { excluding: { refs: ['origin/feat', 'main'] } });

		const args = argv();
		assert.deepStrictEqual(args.slice(-5), ['feat', '--not', 'origin/feat', 'main', '--']);
	});

	test('without excluding the argv is unchanged', async () => {
		await provider.getLogShas(repoPath, 'feat');

		const args = argv();
		assert.deepStrictEqual(args.slice(-2), ['feat', '--']);
		assert.ok(!args.includes('--not'));
	});

	test('an omitted rev with excluding is passed as HEAD, since git lists nothing for a bare --not', async () => {
		await provider.getLogShas(repoPath, undefined, { excluding: { refs: ['main'] } });

		assert.deepStrictEqual(argv().slice(-4), ['HEAD', '--not', 'main', '--']);
	});

	test('an omitted rev without excluding stays omitted', async () => {
		await provider.getLogShas(repoPath);

		assert.strictEqual(argv().at(-1), '--');
		assert.ok(!argv().includes('HEAD'));
	});

	test('two calls differing only in excluding do not share a cache entry', async () => {
		await provider.getLogShas(repoPath, 'feat');
		await provider.getLogShas(repoPath, 'feat', { excluding: { refs: ['main'] } });
		await provider.getLogShas(repoPath, 'feat', { excluding: { refs: ['other'] } });

		assert.strictEqual(run.callCount, 3);
	});
});
