import * as assert from 'assert';
import { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import { CancellationError } from '@gitlens/utils/cancellation.js';
import type { CliGitProviderInternal } from '../../cliGitProvider.js';
import type { Git } from '../../exec/git.js';
import { DiffGitSubProvider } from '../diff.js';

const repoPath = '/test/repo';

/** A diff provider whose `git diff` succeeds with `diffStdout` and whose untracked listing rejects with `failure` */
function createProvider(cache: Cache, failure: Error, diffStdout = ''): DiffGitSubProvider {
	const git = {
		run: () =>
			Promise.resolve({ stdout: diffStdout, stderr: '', exitCode: 0, completion: { status: 'exited', code: 0 } }),
	};
	const provider = { status: { getUntrackedFiles: () => Promise.reject(failure) } };

	return new DiffGitSubProvider(
		{ config: undefined } as unknown as GitServiceContext,
		git as unknown as Git,
		cache,
		provider as unknown as CliGitProviderInternal,
	);
}

suite('DiffGitSubProvider — untracked listing failures', () => {
	let cache: Cache;

	setup(() => {
		cache = new Cache();
	});

	teardown(() => {
		cache.dispose();
	});

	test("getDiffStatus rejects a failed listing under errors: 'throw'", async () => {
		const failure = new Error('fatal: not a git repository');
		const provider = createProvider(cache, failure);

		await assert.rejects(
			provider.getDiffStatus(repoPath, 'HEAD', undefined, { includeUntracked: true, errors: 'throw' }),
			(ex: unknown) => ex === failure,
		);
	});

	test('getDiffStatus adds nothing for a failed listing by default', async () => {
		const provider = createProvider(cache, new Error('fatal: not a git repository'));

		assert.strictEqual(
			await provider.getDiffStatus(repoPath, 'HEAD', undefined, { includeUntracked: true }),
			undefined,
		);
	});

	test("getChangedFilesCount rejects a failed listing under errors: 'throw'", async () => {
		const failure = new Error('fatal: not a git repository');
		const provider = createProvider(cache, failure);

		await assert.rejects(
			provider.getChangedFilesCount(repoPath, undefined, undefined, { includeUntracked: true, errors: 'throw' }),
			(ex: unknown) => ex === failure,
		);
	});

	test('getChangedFilesCount adds nothing for a failed listing by default', async () => {
		const provider = createProvider(cache, new Error('fatal: not a git repository'));

		assert.strictEqual(
			await provider.getChangedFilesCount(repoPath, undefined, undefined, { includeUntracked: true }),
			undefined,
		);
	});

	test('getDiffStatus keeps the tracked files when the listing times out by default', async () => {
		const provider = createProvider(cache, new CancellationError(undefined, 'timeout'), '1\t0\ta.txt\0');

		const files = await provider.getDiffStatus(repoPath, 'HEAD', undefined, { includeUntracked: true });
		assert.deepStrictEqual(
			files?.map(f => f.path),
			['a.txt'],
		);
	});

	test('getChangedFilesCount counts the tracked files when the listing times out by default', async () => {
		const provider = createProvider(
			cache,
			new CancellationError(undefined, 'timeout'),
			' 1 file changed, 1 insertion(+)\n',
		);

		const stat = await provider.getChangedFilesCount(repoPath, undefined, undefined, { includeUntracked: true });
		assert.strictEqual(stat?.files, 1);
	});
});
