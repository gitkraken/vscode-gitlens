import * as assert from 'assert';
import * as sinon from 'sinon';
import { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { GitResult, GitRunOptions } from '@gitlens/git/run.types.js';
import { CancellationError, isCancellationError } from '@gitlens/utils/cancellation.js';
import type { CliGitProviderInternal } from '../../cliGitProvider.js';
import type { Git } from '../../exec/git.js';
import { CommitsGitSubProvider } from '../commits.js';

const repoPath = '/repo';
const sha = 'c'.repeat(40);

function exited(stdout: string): GitResult {
	return { stdout: stdout, stderr: undefined, exitCode: 0, completion: { status: 'exited', code: 0 } };
}

function cancelledResult(): GitResult {
	return {
		stdout: '',
		stderr: undefined,
		completion: { status: 'cancelled', reason: 'aborted', error: new CancellationError() },
	};
}

interface PendingRun {
	readonly options: GitRunOptions;
	finish(result: GitResult): void;
	/** True once the run's own `cancellation` signal fired, i.e. the git process would have been killed */
	readonly killed: boolean;
}

/**
 * A `git.run` whose every call stays pending until the test finishes it, and which reacts to the run's own
 * `cancellation` the way the real one does (a cancelled result, or a rejection when errors are not ignored)
 */
function pendingGit(): { git: Git; run: sinon.SinonStub; runs: PendingRun[] } {
	const runs: PendingRun[] = [];
	const run = sinon.stub().callsFake((options: GitRunOptions) => {
		return new Promise<GitResult>((resolve, reject) => {
			const pending: PendingRun & { killedFlag: boolean } = {
				options: options,
				killedFlag: false,
				get killed() {
					return this.killedFlag;
				},
				finish: resolve,
			};
			runs.push(pending);

			options.cancellation?.addEventListener(
				'abort',
				() => {
					pending.killedFlag = true;
					if (options.errors === 'ignore') {
						resolve(cancelledResult());
					} else {
						reject(new CancellationError());
					}
				},
				{ once: true },
			);
		});
	});

	return { git: { run: run } as unknown as Git, run: run, runs: runs };
}

async function flush(): Promise<void> {
	await new Promise<void>(resolve => setImmediate(resolve));
}

suite('Shared git reads are not tied to the first caller’s cancellation', () => {
	let cache: Cache;
	let runs: PendingRun[];
	let run: sinon.SinonStub;
	let provider: CommitsGitSubProvider;

	setup(() => {
		cache = new Cache();
		const fake = pendingGit();
		runs = fake.runs;
		run = fake.run;
		provider = new CommitsGitSubProvider(
			{} as unknown as GitServiceContext,
			fake.git,
			cache,
			{} as unknown as CliGitProviderInternal,
		);
	});

	teardown(() => {
		sinon.restore();
		cache.dispose();
	});

	type Read<T> = (cancellation?: AbortSignal) => Promise<T>;

	function testSharing<T>(name: string, read: Read<T>, output: string, expected: T): void {
		suite(name, () => {
			test('the first caller aborting rejects it, and the second still gets the answer without the run being killed', async () => {
				const controller = new AbortController();
				const first = read(controller.signal);
				const firstSettled = first.then(
					() => undefined,
					(ex: unknown) => ex,
				);
				await flush();
				const second = read();
				await flush();
				assert.strictEqual(run.callCount, 1, 'one shared git run');

				controller.abort();
				assert.ok(isCancellationError(await firstSettled), 'the aborted caller is rejected');
				assert.strictEqual(runs[0].killed, false, 'the shared run keeps going for the other caller');

				runs[0].finish(exited(output));
				assert.deepStrictEqual(await second, expected);
				assert.strictEqual(run.callCount, 1);
			});

			test('the shared run is cancelled when every caller aborts, and the cancelled run is not kept', async () => {
				const a = new AbortController();
				const b = new AbortController();
				const first = read(a.signal).catch((ex: unknown) => ex);
				await flush();
				const second = read(b.signal).catch((ex: unknown) => ex);
				await flush();
				assert.strictEqual(run.callCount, 1);

				a.abort();
				await flush();
				assert.strictEqual(runs[0].killed, false);
				b.abort();

				assert.ok(isCancellationError(await first));
				assert.ok(isCancellationError(await second));
				assert.strictEqual(runs[0].killed, true, 'the run is cancelled once nobody is waiting');

				const next = read();
				await flush();
				assert.strictEqual(run.callCount, 2, 'the cancelled run was not kept');
				runs[1].finish(exited(output));
				assert.deepStrictEqual(await next, expected);
			});
		});
	}

	testSharing('getInitialCommitSha', c => provider.getInitialCommitSha(repoPath, c), `${sha}\n`, sha);

	testSharing(
		'getLeftRightCommitCount',
		c => provider.getLeftRightCommitCount(repoPath, 'a...b', undefined, c),
		'2\t3',
		{ left: 2, right: 3 },
	);

	testSharing('getCommitReachability', c => provider.getCommitReachability(repoPath, sha, c), 'refs/heads/main\n', {
		refs: [{ refType: 'branch', name: 'main', remote: false, current: false }],
	});

	testSharing('getLogShas', c => provider.getLogShas(repoPath, 'main', { limit: 5 }, c), `${sha}\0`, [sha]);

	test('an author-filtered left/right count stays unshared and is bound to its own caller', async () => {
		const controller = new AbortController();
		const pending = provider
			.getLeftRightCommitCount(repoPath, 'a...b', { authors: [{ name: 'A', email: 'a@x' }] }, controller.signal)
			.catch((ex: unknown) => ex);
		await flush();

		controller.abort();

		assert.ok(isCancellationError(await pending));
		assert.strictEqual(runs[0].killed, true);
	});
});
