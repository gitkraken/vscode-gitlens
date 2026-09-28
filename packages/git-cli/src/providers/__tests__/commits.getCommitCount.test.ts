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

suite('CommitsGitSubProvider.getCommitCount — excluding', () => {
	let cache: Cache;
	let run: sinon.SinonStub;
	let provider: CommitsGitSubProvider;

	setup(() => {
		cache = new Cache();
		run = sinon.stub().resolves(exited('3'));
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

	function argv(): string[] {
		return (run.getCall(0).args as unknown[]).slice(1).filter((a): a is string => typeof a === 'string');
	}

	test('no options leaves the argv exactly as today', async () => {
		await provider.getCommitCount(repoPath, 'HEAD');

		assert.deepStrictEqual(argv(), ['rev-list', '--count', 'HEAD', '--']);
	});

	test('branches + remotes + tags with a branch except', async () => {
		await provider.getCommitCount(repoPath, 'HEAD', {
			excluding: { branches: true, remotes: true, tags: true, except: ['refs/heads/feat'] },
		});

		assert.deepStrictEqual(argv(), [
			'rev-list',
			'--count',
			'HEAD',
			'--not',
			'--exclude=feat',
			'--branches',
			'--remotes',
			'--tags',
			'--',
		]);
	});

	test('a remote except lands before --remotes, normalized to its short name', async () => {
		await provider.getCommitCount(repoPath, 'HEAD', {
			excluding: { remotes: true, except: ['refs/remotes/o/feat'] },
		});

		assert.deepStrictEqual(argv(), ['rev-list', '--count', 'HEAD', '--not', '--exclude=o/feat', '--remotes', '--']);
	});

	test('a tag except lands before --tags, normalized to its short name', async () => {
		await provider.getCommitCount(repoPath, 'HEAD', {
			excluding: { tags: true, except: ['refs/tags/v1'] },
		});

		assert.deepStrictEqual(argv(), ['rev-list', '--count', 'HEAD', '--not', '--exclude=v1', '--tags', '--']);
	});

	test('an except entry in a namespace that is not enabled is dropped entirely', async () => {
		await provider.getCommitCount(repoPath, 'HEAD', {
			excluding: { branches: true, except: ['refs/heads/feat', 'refs/tags/v1'] },
		});

		assert.deepStrictEqual(argv(), ['rev-list', '--count', 'HEAD', '--not', '--exclude=feat', '--branches', '--']);
	});

	test('excluding.refs are passed verbatim, after the pseudo-ref groups', async () => {
		await provider.getCommitCount(repoPath, 'HEAD', {
			excluding: { branches: true, refs: ['refs/heads/other', 'some-tag'] },
		});

		assert.deepStrictEqual(argv(), [
			'rev-list',
			'--count',
			'HEAD',
			'--not',
			'--branches',
			'refs/heads/other',
			'some-tag',
			'--',
		]);
	});

	test('two calls differing only in excluding do not share a cache entry', async () => {
		await provider.getCommitCount(repoPath, 'HEAD');
		await provider.getCommitCount(repoPath, 'HEAD', { excluding: { branches: true } });

		assert.strictEqual(run.callCount, 2, 'a non-default variant must not join the default run');
	});
});
