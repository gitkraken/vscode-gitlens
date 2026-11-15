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
		getDiffReadConfigs: () => Promise.resolve([]),
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

const backslashDiff = [
	'diff --git "a/back\\\\slash.txt" "b/back\\\\slash.txt"',
	'index 1111111..2222222 100644',
	'--- "a/back\\\\slash.txt"',
	'+++ "b/back\\\\slash.txt"',
	'@@ -1 +1 @@',
	'-one',
	'+two',
	'',
].join('\n');

/** A diff provider whose `git diff` records each run's arguments and answers with `stdout(args)` */
function createRecordingProvider(
	cache: Cache,
	stdout: (args: string[], index: number) => string = () => '',
): { provider: DiffGitSubProvider; runs: string[][]; relativePathCalls: unknown[] } {
	const runs: string[][] = [];
	const relativePathCalls: unknown[] = [];
	const git = {
		getDiffReadConfigs: () => Promise.resolve([]),
		run: (_options: unknown, ...args: (string | undefined)[]) => {
			const filtered = args.filter((a): a is string => a != null);
			runs.push(filtered);
			return Promise.resolve({
				stdout: stdout(filtered, runs.length - 1),
				stderr: '',
				exitCode: 0,
				completion: { status: 'exited', code: 0 },
			});
		},
	};
	const provider = {
		// The rewriting a `uris` entry goes through
		getRelativePath: (pathOrUri: string) => {
			relativePathCalls.push(pathOrUri);
			return pathOrUri.replace(/\\/g, '/');
		},
	};

	return {
		provider: new DiffGitSubProvider(
			{ config: undefined } as unknown as GitServiceContext,
			git as unknown as Git,
			cache,
			provider as unknown as CliGitProviderInternal,
		),
		runs: runs,
		relativePathCalls: relativePathCalls,
	};
}

suite('DiffGitSubProvider.getDiff — paths', () => {
	let cache: Cache;

	setup(() => {
		cache = new Cache();
	});

	teardown(() => {
		cache.dispose();
	});

	test('passes each path as a literal pathspec, backslashes untouched', async () => {
		const { provider, runs, relativePathCalls } = createRecordingProvider(cache, () => backslashDiff);

		const diff = await provider.getDiff(repoPath, 'HEAD', 'HEAD~1', {
			paths: ['back\\slash.txt', 'dir\\name/file.txt', '[id]/page.txt'],
		});

		assert.strictEqual(diff?.contents, backslashDiff);
		assert.strictEqual(runs.length, 1);
		const args = runs[0];
		assert.deepStrictEqual(args.slice(args.indexOf('--') + 1), [
			':(literal)back\\slash.txt',
			':(literal)dir\\name/file.txt',
			':(literal)[id]/page.txt',
		]);
		assert.deepStrictEqual(relativePathCalls, []);
	});

	test('batches the paths and joins each batch’s output in order', async () => {
		const many = Array.from({ length: 3000 }, (_, i) => `missing/${'x'.repeat(40)}-${i}.txt`);
		const { provider, runs } = createRecordingProvider(cache, (_args, index) => `batch ${index}\n`);

		const diff = await provider.getDiff(repoPath, 'HEAD', 'HEAD~1', { paths: [...many, 'back\\slash.txt'] });

		assert.ok(runs.length > 1, 'the paths should not fit one command line');
		assert.strictEqual(diff?.contents, Array.from({ length: runs.length }, (_, i) => `batch ${i}\n`).join(''));
		const pathspecs = runs.flatMap(args => args.slice(args.indexOf('--') + 1));
		assert.strictEqual(pathspecs.length, many.length + 1);
		assert.strictEqual(pathspecs.at(-1), ':(literal)back\\slash.txt');
	});

	test('wins over uris', async () => {
		const { provider, runs, relativePathCalls } = createRecordingProvider(cache);

		await provider.getDiff(repoPath, 'HEAD', 'HEAD~1', { uris: ['other.txt'], paths: ['back\\slash.txt'] });

		assert.deepStrictEqual(relativePathCalls, []);
		assert.strictEqual(runs.length, 1);
		const args = runs[0];
		assert.deepStrictEqual(args.slice(args.indexOf('--') + 1), [':(literal)back\\slash.txt']);
		assert.ok(!args.includes('other.txt'));
	});

	test('without paths, uris still go through the path rewriting', async () => {
		const { provider, runs, relativePathCalls } = createRecordingProvider(cache);

		await provider.getDiff(repoPath, 'HEAD', 'HEAD~1', { uris: ['back\\slash.txt'] });

		assert.deepStrictEqual(relativePathCalls, ['back\\slash.txt']);
		const args = runs[0];
		assert.deepStrictEqual(args.slice(args.indexOf('--') + 1), ['back/slash.txt']);
	});

	test('an empty list resolves undefined without running git', async () => {
		const { provider, runs } = createRecordingProvider(cache);

		assert.strictEqual(
			await provider.getDiff(repoPath, 'HEAD', 'HEAD~1', { paths: [], uris: ['a.txt'] }),
			undefined,
		);
		assert.strictEqual(
			await provider.getParsedDiff(repoPath, 'HEAD', 'HEAD~1', { paths: [], uris: ['a.txt'] }),
			undefined,
		);
		assert.strictEqual(runs.length, 0);
	});

	test('getParsedDiff parses the file under its literal name', async () => {
		const { provider, runs } = createRecordingProvider(cache, () => backslashDiff);

		const parsed = await provider.getParsedDiff(repoPath, 'HEAD', 'HEAD~1', { paths: ['back\\slash.txt'] });

		assert.deepStrictEqual(
			parsed?.files.map(f => f.path),
			['back\\slash.txt'],
		);
		const args = runs[0];
		assert.deepStrictEqual(args.slice(args.indexOf('--') + 1), [':(literal)back\\slash.txt']);
	});
});
