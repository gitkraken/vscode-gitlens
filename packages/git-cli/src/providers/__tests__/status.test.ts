import * as assert from 'assert';
import { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import type { CliGitProviderInternal } from '../../cliGitProvider.js';
import type { Git } from '../../exec/git.js';
import { computeDeadlockBackstopMs, StatusGitSubProvider } from '../status.js';

const repoPath = '/test/repo';

/** Lets pending microtasks run — the dedup decision is synchronous, but a read only spawns `git` a tick later. */
function flush(): Promise<void> {
	return new Promise<void>(resolve => setImmediate(resolve));
}

/**
 * A `git status --porcelain=v2` payload whose branch name identifies which run produced it — so a test can
 * tell whether a caller got a fresh read or was handed one that started earlier.
 */
function porcelainV2(runLabel: string): string {
	return `# branch.oid 0000000000000000000000000000000000000000\n# branch.head ${runLabel}\n`;
}

/** A `Git` whose `run` blocks until the test releases it, so the "read still in flight" window can be held open.
 *  Models a real `git.run`: it rejects if the passed `cancellation` signal aborts (the process is killed). */
function createDeferredGit(gitTimeout = 60000) {
	const pending: Array<{ resolve: (stdout: string) => void; reject: (e: unknown) => void; settled: boolean }> = [];
	const correlationKeys: Array<string | undefined> = [];

	const git = {
		options: { gitTimeout: gitTimeout },
		supports: () => Promise.resolve(true),
		run: (options: { correlationKey?: string; cancellation?: AbortSignal }) =>
			new Promise((resolve, reject) => {
				correlationKeys.push(options?.correlationKey);
				const entry = {
					resolve: (stdout: string) => resolve({ stdout: stdout, stderr: '', exitCode: 0 }),
					reject: reject,
					settled: false,
				};
				pending.push(entry);
				options?.cancellation?.addEventListener(
					'abort',
					() => {
						if (!entry.settled) {
							entry.settled = true;
							reject(new Error('aborted'));
						}
					},
					{ once: true },
				);
			}),
	};

	return {
		git: git as unknown as Git,
		/** Number of `git status` processes actually started. */
		get runs(): number {
			return pending.length;
		},
		/** The `correlationKey` the nth (0-based) started run was tagged with (the exec-layer dedup key). */
		correlationKey: function (index: number): string | undefined {
			return correlationKeys[index];
		},
		/** Whether the nth started run has settled (resolved or aborted). */
		settled: function (index: number): boolean {
			return pending[index]?.settled ?? false;
		},
		/** Settles the nth (0-based) started run, labelling its output so callers can be traced back to it. */
		settle: function (index: number, runLabel: string): void {
			const entry = pending[index];
			if (entry.settled) return;

			entry.settled = true;
			entry.resolve(porcelainV2(runLabel));
		},
	};
}

function createProvider(cache: Cache, git: Git): StatusGitSubProvider {
	return new StatusGitSubProvider(
		{ config: undefined } as unknown as GitServiceContext,
		git,
		cache,
		{} as unknown as CliGitProviderInternal,
	);
}

suite('StatusGitSubProvider — generation-stamped dedup', () => {
	let cache: Cache;

	setup(() => {
		cache = new Cache();
	});

	teardown(() => {
		cache.dispose();
	});

	test('concurrent callers in the same generation share one `git status`', async () => {
		const fake = createDeferredGit();
		const provider = createProvider(cache, fake.git);

		const first = provider.getStatus(repoPath);
		const second = provider.getStatus(repoPath);
		await flush();

		assert.strictEqual(fake.runs, 1, 'the second caller should join the in-flight read, not start another');

		fake.settle(0, 'run1');

		assert.strictEqual((await first)?.branch, 'run1');
		assert.strictEqual((await second)?.branch, 'run1');
	});

	test('a caller that arrives after a change does NOT join the pre-change read', async () => {
		const fake = createDeferredGit();
		const provider = createProvider(cache, fake.git);

		// A read starts (e.g. the worktrees sidebar) and is still running...
		const before = provider.getStatus(repoPath);
		await flush();
		assert.strictEqual(fake.runs, 1);

		// ...when the user commits. The watcher tick advances the clock.
		cache.onRepositoryChanged(repoPath, ['index']);

		// The post-commit read must start its own `git status` — joining the one above would report the
		// pre-commit file list, which is exactly the Graph WIP staleness bug.
		const after = provider.getStatus(repoPath);
		await flush();
		assert.strictEqual(fake.runs, 2, 'the post-change caller must not join the pre-change read');

		fake.settle(0, 'pre-commit');
		fake.settle(1, 'post-commit');

		assert.strictEqual((await before)?.branch, 'pre-commit', 'the original caller still gets its own read');
		assert.strictEqual((await after)?.branch, 'post-commit', 'the post-change caller gets a fresh read');
	});

	test('a working-tree change (external discard) also refuses the join', async () => {
		const fake = createDeferredGit();
		const provider = createProvider(cache, fake.git);

		void provider.getStatus(repoPath);
		await flush();

		cache.onWorkingTreeChanged(repoPath);

		const after = provider.getStatus(repoPath);
		await flush();
		assert.strictEqual(fake.runs, 2);

		fake.settle(0, 'pre-discard');
		fake.settle(1, 'post-discard');

		assert.strictEqual((await after)?.branch, 'post-discard');
	});

	test('callers after the read settles start a fresh one (no memoization)', async () => {
		const fake = createDeferredGit();
		const provider = createProvider(cache, fake.git);

		const first = provider.getStatus(repoPath);
		await flush();
		fake.settle(0, 'run1');
		await first;

		// Same generation, but the in-flight entry is gone — `git status` is a point-in-time read and must
		// never be served from a settled cache here.
		void provider.getStatus(repoPath);
		await flush();
		assert.strictEqual(fake.runs, 2);
	});

	test('a { force } read starts fresh AND fences the pre-force run for later ordinary readers', async () => {
		const fake = createDeferredGit();
		const provider = createProvider(cache, fake.git);

		// An ordinary read is in flight (run 0)...
		const ordinary = provider.getStatus(repoPath);
		await flush();
		assert.strictEqual(fake.runs, 1);

		// ...a forced read must start its OWN run (run 1) rather than join the pending one: the user asserting
		// "something changed" is precisely the claim that run 0's in-flight content is already stale.
		const forced = provider.getStatus(repoPath, { force: true });
		await flush();
		assert.strictEqual(fake.runs, 2, 'a force read must not join an in-flight read');

		// ...and the force's clock advance fences run 0 for EVERYONE, not just the forcing caller. A later
		// ordinary read joins the forced run — it must neither be served the pre-force run it would otherwise
		// still be eligible for, nor spawn a third `git status` when a fresh one is already running.
		const joiner = provider.getStatus(repoPath);
		await flush();
		assert.strictEqual(fake.runs, 2, 'a later ordinary read shares the forced run rather than spawning its own');

		// Label the runs distinctly and prove the routing: the joiner resolves with run 1's output, not run 0's.
		fake.settle(0, 'ordinary');
		fake.settle(1, 'forced');
		assert.strictEqual((await ordinary)?.branch, 'ordinary', 'the pre-force caller keeps its own run');
		assert.strictEqual((await forced)?.branch, 'forced', 'the force read gets its own run');
		assert.strictEqual(
			(await joiner)?.branch,
			'forced',
			'a read arriving after a force must never be served pre-force content',
		);
	});

	test('reads are deduped per repo, not globally', async () => {
		const fake = createDeferredGit();
		const provider = createProvider(cache, fake.git);

		void provider.getStatus(repoPath);
		void provider.getStatus('/test/other');
		await flush();

		assert.strictEqual(fake.runs, 2, "a second repo must not join the first repo's read");
	});

	test('distinct reads do not share a slot', async () => {
		const fake = createDeferredGit();
		const provider = createProvider(cache, fake.git);

		void provider.getStatus(repoPath);
		void provider.getUntrackedFiles(repoPath);
		await flush();

		assert.strictEqual(fake.runs, 2, 'getUntrackedFiles must not be answered by the in-flight getStatus');
	});

	test('tags git.run with a generation-derived correlationKey that changes on an increment', async () => {
		const fake = createDeferredGit();
		const provider = createProvider(cache, fake.git);

		// The correlationKey is what carries the fence down to the exec-layer command dedup (`Git.pendingCommands`),
		// where a signal-less post-change caller would otherwise join the pre-change `git status` process.
		void provider.getStatus(repoPath);
		await flush();
		const before = fake.correlationKey(0);
		assert.ok(before != null, 'the status run must be tagged with a correlationKey');

		cache.onRepositoryChanged(repoPath, ['index']);

		void provider.getStatus(repoPath);
		await flush();
		const after = fake.correlationKey(1);
		assert.notStrictEqual(after, before, 'a post-change read must carry a different correlationKey (no exec join)');
	});

	test('getStatusForPath(renames) shares getStatus rather than spawning a duplicate `git status`', async () => {
		const fake = createDeferredGit();
		const provider = createProvider(cache, fake.git);

		// Rename-aware path status runs the identical full `git status` as getStatus — it must join, not double.
		void provider.getStatus(repoPath);
		void provider.getStatusForPath(repoPath, `${repoPath}/file.txt`); // renames defaults to true
		await flush();

		assert.strictEqual(fake.runs, 1, 'getStatusForPath(renames) must join getStatus, not run a second git status');
	});

	test('getStatusForPath({renames:false}) runs its own pathspec-scoped status', async () => {
		const fake = createDeferredGit();
		const provider = createProvider(cache, fake.git);

		void provider.getStatus(repoPath);
		void provider.getStatusForPath(repoPath, `${repoPath}/file.txt`, { renames: false });
		await flush();

		assert.strictEqual(fake.runs, 2, 'a pathspec-scoped status is a distinct command and must not join getStatus');
	});

	test('getStatusForFile and getStatusForPath ({renames:false}) share one pathspec-scoped run', async () => {
		const fake = createDeferredGit();
		const provider = createProvider(cache, fake.git);

		// Exact and non-exact run the byte-identical pathspec-scoped command — `exact` is not in the dedup key.
		void provider.getStatusForFile(repoPath, `${repoPath}/file.txt`, { renames: false });
		void provider.getStatusForPath(repoPath, `${repoPath}/file.txt`, { renames: false });
		await flush();

		assert.strictEqual(fake.runs, 1, 'exact/non-exact must share one run — `exact` must not fragment the key');
	});

	test('hasWorkingChanges dedups by its option tuple', async () => {
		const fake = createDeferredGit();
		const provider = createProvider(cache, fake.git);

		// Same options -> shared run; a throwOnError:true caller must NOT join a graceful run (different key).
		void provider.hasWorkingChanges(repoPath, { staged: true, unstaged: true, untracked: false });
		void provider.hasWorkingChanges(repoPath, { staged: true, unstaged: true, untracked: false });
		await flush();
		const sharedRuns = fake.runs;

		void provider.hasWorkingChanges(repoPath, {
			staged: true,
			unstaged: true,
			untracked: false,
			throwOnError: true,
		});
		await flush();

		assert.strictEqual(sharedRuns, 1, 'identical-option callers share one run');
		assert.strictEqual(fake.runs, 2, 'a throwOnError:true caller must start its own run (not join a graceful one)');
	});

	test('one caller cancelling does not reject or kill a co-joined caller', async () => {
		const fake = createDeferredGit();
		const provider = createProvider(cache, fake.git);

		// Caller A passes a signal; caller B (same generation) joins with none.
		const ctrlA = new AbortController();
		const a = provider.getStatus(repoPath, undefined, ctrlA.signal);
		const b = provider.getStatus(repoPath);
		await flush();
		assert.strictEqual(fake.runs, 1, 'B joins A rather than starting a second run');

		// A cancels. B passed no signal, so the aggregate must NOT fire — the shared git run keeps running.
		ctrlA.abort();
		await flush();
		assert.strictEqual(fake.settled(0), false, 'the shared git run must survive A cancelling (B keeps it alive)');

		fake.settle(0, 'shared');
		await assert.rejects(a, 'the cancelling caller rejects');
		assert.strictEqual((await b)?.branch, 'shared', 'the co-joined caller still resolves with the real result');
	});
});

suite('computeDeadlockBackstopMs', () => {
	test('scales to 2x a configured git timeout (never below it, so git.run rejects first)', () => {
		assert.strictEqual(computeDeadlockBackstopMs(60000), 120000);
		assert.strictEqual(computeDeadlockBackstopMs(300000), 600000);
	});

	test('defaults to 2x 60s when the timeout is unset', () => {
		assert.strictEqual(computeDeadlockBackstopMs(undefined), 120000);
	});

	test('falls back to a fixed floor when the timeout is disabled (0) — recovery is never disabled', () => {
		const backstop = computeDeadlockBackstopMs(0);
		assert.ok(backstop > 0, 'disabling the git timeout must NOT disable the deadlock backstop');
	});
});

suite('deadlock backstop end-to-end', () => {
	test('a wedged read is eventually rejected so waiters unblock', async () => {
		const cache = new Cache();
		// Tiny timeout so the backstop (2x) fires fast in-test.
		const provider = createProvider(cache, createDeferredGit(15).git);

		// The fake `run` never settles; the backstop must reject the read rather than hang forever.
		await assert.rejects(provider.getStatus(repoPath), (e: unknown) => isCancellationError(e));
		cache.dispose();
	});

	test('the backstop aborts the underlying git op (releases its process/slot) rather than orphaning it', async () => {
		const cache = new Cache();
		const fake = createDeferredGit(15);
		const provider = createProvider(cache, fake.git);

		await assert.rejects(provider.getStatus(repoPath), (e: unknown) => isCancellationError(e));
		// The backstop aborts the run's linked signal, so the underlying op settles (aborted) instead of running on.
		assert.strictEqual(fake.settled(0), true, 'the backstop must abort the underlying git op, not orphan it');
		cache.dispose();
	});
});
