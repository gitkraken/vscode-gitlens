import * as assert from 'assert';
import * as sinon from 'sinon';
import { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { GitResult } from '@gitlens/git/run.types.js';
import { CancellationError, isCancellationError } from '@gitlens/utils/cancellation.js';
import { fileUri } from '@gitlens/utils/uri.js';
import type { CliGitProviderInternal } from '../../cliGitProvider.js';
import { CancelledRunError } from '../../exec/exec.errors.js';
import type { Git } from '../../exec/git.js';
import { defaultGitTimeout } from '../../exec/git.js';
import { commitReadClock, CommitsGitSubProvider } from '../commits.js';

const repoPath = '/repo';
const siblingPath = '/repo.worktrees/feature';
const sha = 'a'.repeat(40);
const wait = 10 * 60 * 1000;
// Git's own default for `diff.renameLimit`
const renameLimit = 1000;

const streamTimedOut = () => new CancelledRunError('git log', true, undefined, 'SIGTERM', 'timeout');
const runTimedOut = () => new CancellationError(new Error('Timed out'), 'timeout');

type Call = { kind: 'stream' | 'run'; options: { timeout?: number }; args: string[] };

suite('CommitsGitSubProvider.getLog — a read that runs out of time with unlimited rename detection', () => {
	let cache: Cache;
	let calls: Call[];
	let outcomes: (() => Error | undefined)[];
	let now: number;

	function createProvider(gitOptions: { gitTimeout?: number } = {}): CommitsGitSubProvider {
		const git = {
			options: gitOptions,
			supports: () => Promise.resolve(true),
			// eslint-disable-next-line require-yield
			stream: async function* (options: { timeout?: number }, ...args: string[]): AsyncGenerator<string> {
				calls.push({ kind: 'stream', options: options, args: args });
				const failure = outcomes.shift()?.();
				if (failure != null) throw failure;
			},
			run: (options: { timeout?: number }, ...args: string[]): Promise<GitResult> => {
				calls.push({ kind: 'run', options: options, args: args });
				const failure = outcomes.shift()?.();
				if (failure != null) return Promise.reject(failure);

				return Promise.resolve({
					stdout: '',
					stderr: undefined,
					exitCode: 0,
					completion: { status: 'exited', code: 0 },
				});
			},
		} as unknown as Git;

		return new CommitsGitSubProvider({} as unknown as GitServiceContext, git, cache, {
			config: { getCurrentUser: () => Promise.resolve(undefined) },
		} as unknown as CliGitProviderInternal);
	}

	const limit = `-l${renameLimit}`;
	const hasRenames = (call: Call) => call.args.some(a => a.startsWith('-M'));
	/** The call keeps its rename argument and has the limit right after it */
	const isLimited = (call: Call) => {
		const index = call.args.findIndex(a => a.startsWith('-M'));
		return index >= 0 && call.args[index + 1] === limit;
	};
	const isUnlimited = (call: Call) => hasRenames(call) && !call.args.includes(limit);
	const withoutLimit = (args: string[]) => args.filter(a => a !== limit);
	const page = { limit: 10, includeFiles: true };
	const single = { limit: 1 };

	setup(() => {
		cache = new Cache();
		calls = [];
		outcomes = [];
		now = 0;
		sinon.stub(commitReadClock, 'now').callsFake(() => now);
	});

	teardown(() => {
		sinon.restore();
		cache.dispose();
	});

	suite('a page', () => {
		test('is read once more with git’s rename limit, keeping its renames, and that is what is returned', async () => {
			outcomes = [streamTimedOut, () => undefined];
			const provider = createProvider();

			const log = await provider.getLog(repoPath, 'HEAD', page);

			assert.ok(log != null, 'the page comes back');
			assert.strictEqual(calls.length, 2);
			assert.strictEqual(isUnlimited(calls[0]), true);
			assert.strictEqual(calls[0].options.timeout, defaultGitTimeout, 'the first read has the limit a run has');
			assert.strictEqual(isLimited(calls[1]), true);
			assert.strictEqual(
				calls[1].options.timeout,
				undefined,
				'the second read is unlimited in time, as reads are without one',
			);
			assert.deepStrictEqual(withoutLimit(calls[1].args), calls[0].args, 'nothing else about the read changes');
			for (const call of calls) {
				assert.ok(!call.args.includes('--no-renames'));
			}
		});

		test('a host-set time limit is the one used, and a disabled one means none', async () => {
			await createProvider({ gitTimeout: 5000 }).getLog(repoPath, 'HEAD', page);
			await createProvider({ gitTimeout: 0 }).getLog(repoPath, 'HEAD', page);

			assert.deepStrictEqual(
				calls.map(c => c.options.timeout),
				[5000, 0],
			);
		});

		test('a failure that is not running out of time is not read again', async () => {
			outcomes = [
				() => new Error('fatal: bad revision'),
				() => new CancelledRunError('git log', true, undefined, 'SIGTERM', 'unknown'),
			];
			const provider = createProvider();

			assert.strictEqual(await provider.getLog(repoPath, 'HEAD', page), undefined);
			assert.strictEqual(await provider.getLog(repoPath, 'v1', page), undefined);
			assert.strictEqual(calls.length, 2, 'one read each');
		});

		test('a cancellation is not read again, and is not remembered', async () => {
			outcomes = [() => new CancellationError(undefined, 'aborted')];
			const provider = createProvider();

			await assert.rejects(provider.getLog(repoPath, 'HEAD', page), isCancellationError);
			assert.strictEqual(calls.length, 1);

			const controller = new AbortController();
			outcomes = [
				() => {
					controller.abort();
					return streamTimedOut();
				},
			];
			await provider.getLog(repoPath, 'HEAD', page, controller.signal).catch(() => undefined);
			assert.strictEqual(calls.length, 2, 'a timeout the caller aborted over is not read again');

			outcomes = [() => undefined];
			await provider.getLog(repoPath, 'HEAD', page);
			assert.strictEqual(isUnlimited(calls[2]), true, 'neither is held against the repository');
		});

		test('a second read that fails fails as it would have', async () => {
			outcomes = [streamTimedOut, () => new Error('fatal: unable to read')];
			const provider = createProvider();

			assert.strictEqual(await provider.getLog(repoPath, 'HEAD', page), undefined);
			assert.strictEqual(calls.length, 2);
		});

		test('a read with no page size is given no time limit, and is not read again', async () => {
			outcomes = [streamTimedOut];
			const provider = createProvider();

			assert.strictEqual(await provider.getLog(repoPath, 'HEAD', { limit: 0, includeFiles: true }), undefined);
			assert.strictEqual(calls.length, 1);
			assert.strictEqual(calls[0].options.timeout, undefined);
			assert.strictEqual(isUnlimited(calls[0]), true);
		});

		test('a read without file details is left as it was', async () => {
			outcomes = [streamTimedOut];
			const provider = createProvider();

			assert.strictEqual(await provider.getLog(repoPath, 'HEAD', { limit: 10, includeFiles: false }), undefined);
			assert.strictEqual(calls.length, 1);
			assert.strictEqual(calls[0].options.timeout, undefined);
		});
	});

	suite('a single commit', () => {
		test('is read once more with git’s rename limit when its run times out', async () => {
			outcomes = [runTimedOut, () => undefined];
			const provider = createProvider();

			await provider.getLog(repoPath, sha, single);

			assert.strictEqual(calls.length, 2);
			assert.deepStrictEqual(
				calls.map(c => c.kind),
				['run', 'run'],
			);
			assert.strictEqual(isUnlimited(calls[0]), true);
			assert.strictEqual(isLimited(calls[1]), true);
			assert.deepStrictEqual(withoutLimit(calls[1].args), calls[0].args);
			assert.strictEqual(calls[0].options.timeout, undefined, 'the run keeps its own default time limit');
		});

		test('is not read again after another failure or a cancellation', async () => {
			outcomes = [
				() => new Error('fatal: bad object'),
				() => new CancellationError(undefined, 'aborted'),
				() => new CancellationError(new Error('Timed out'), 'unknown'),
			];
			const provider = createProvider();

			assert.strictEqual(await provider.getLog(repoPath, sha, single), undefined);
			await assert.rejects(provider.getLog(repoPath, sha, single), isCancellationError);
			await assert.rejects(provider.getLog(repoPath, sha, single), isCancellationError);
			assert.strictEqual(calls.length, 3, 'one read each');

			const controller = new AbortController();
			outcomes = [
				() => {
					controller.abort();
					return runTimedOut();
				},
			];
			await provider.getLog(repoPath, sha, single, controller.signal).catch(() => undefined);
			assert.strictEqual(calls.length, 4, 'a timeout the caller aborted over is not read again');
		});

		test('a second read that fails fails as it would have', async () => {
			outcomes = [runTimedOut, runTimedOut];
			const provider = createProvider();

			await assert.rejects(provider.getLog(repoPath, sha, single), isCancellationError);
			assert.strictEqual(calls.length, 2);
		});
	});

	suite('after a read ran out of time', () => {
		test('the repository’s other pages and single commits go straight to the rename limit', async () => {
			outcomes = [streamTimedOut];
			const provider = createProvider();

			await provider.getLog(repoPath, 'HEAD', page);
			assert.strictEqual(calls.length, 2);

			await provider.getLog(repoPath, 'HEAD', page);
			assert.strictEqual(calls.length, 3, 'one read, not two');
			assert.strictEqual(isLimited(calls[2]), true);
			assert.strictEqual(calls[2].options.timeout, undefined);

			await provider.getLog(repoPath, 'feature', { ...page, limit: 20 });
			assert.strictEqual(isLimited(calls[3]), true, 'another page');

			await provider.getLog(repoPath, sha, single);
			assert.strictEqual(isLimited(calls[4]), true, 'a single commit');
			assert.strictEqual(calls.length, 5);
		});

		test('a single commit that timed out sends the repository’s pages to the rename limit', async () => {
			outcomes = [runTimedOut];
			const provider = createProvider();

			await provider.getLog(repoPath, sha, single);
			await provider.getLog(repoPath, 'HEAD', page);

			assert.strictEqual(isLimited(calls[2]), true);
			assert.strictEqual(calls.length, 3);
		});

		test('a worktree of the repository goes there too, and another repository does not', async () => {
			cache.registerRepoPath(fileUri(siblingPath), {
				uri: fileUri('/repo/.git/worktrees/feature'),
				commonUri: fileUri('/repo/.git'),
			});
			assert.strictEqual(cache.getCommonPath(siblingPath), repoPath, 'the worktree shares the repository’s path');

			outcomes = [streamTimedOut];
			const provider = createProvider();
			await provider.getLog(repoPath, 'HEAD', page);

			await provider.getLog(siblingPath, 'HEAD', page);
			assert.strictEqual(isLimited(calls[2]), true);

			await provider.getLog('/other', 'HEAD', page);
			assert.strictEqual(isUnlimited(calls[3]), true);
			assert.strictEqual(calls[3].options.timeout, defaultGitTimeout);
		});

		test('unlimited renames are tried again once the wait has passed', async () => {
			outcomes = [streamTimedOut];
			const provider = createProvider();
			await provider.getLog(repoPath, 'HEAD', page);

			now += wait - 1;
			await provider.getLog(repoPath, 'HEAD', page);
			assert.strictEqual(isLimited(calls[2]), true);

			now += 1;
			await provider.getLog(repoPath, 'HEAD', page);
			assert.strictEqual(isUnlimited(calls[3]), true);
			assert.strictEqual(calls[3].options.timeout, defaultGitTimeout);
		});
	});
});
