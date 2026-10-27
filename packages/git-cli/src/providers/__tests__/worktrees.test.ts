import * as assert from 'assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as sinon from 'sinon';
import { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import { GitBranch } from '@gitlens/git/models/branch.js';
import type { GitWorktree } from '@gitlens/git/models/worktree.js';
import type { GitResult, GitRunOptions } from '@gitlens/git/run.types.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import type { Deferred } from '@gitlens/utils/promise.js';
import { defer } from '@gitlens/utils/promise.js';
import { fileUri } from '@gitlens/utils/uri.js';
import type { CliGitProviderInternal } from '../../cliGitProvider.js';
import type { Git } from '../../exec/git.js';
import { WorktreesGitSubProvider } from '../worktrees.js';

function exited(stdout: string): GitResult {
	return { stdout: stdout, stderr: undefined, exitCode: 0, completion: { status: 'exited', code: 0 } };
}

function failed(): GitResult {
	return {
		stdout: '',
		stderr: undefined,
		completion: { status: 'failed', reason: 'unstarted', error: new Error('spawn failed') },
	};
}

suite('WorktreesGitSubProvider.pruneWorktrees', () => {
	const repoPath = '/repo';
	const listing =
		'worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /wt\nHEAD def\nbranch refs/heads/side\n';

	let run: sinon.SinonStub;
	let unregisterRepoPath: sinon.SinonSpy;
	let provider: WorktreesGitSubProvider;

	setup(() => {
		run = sinon.stub();
		const git = { ensureSupports: () => Promise.resolve(), run: run } as unknown as Git;
		unregisterRepoPath = sinon.spy();
		const cache = { unregisterRepoPath: unregisterRepoPath } as unknown as Cache;
		provider = new WorktreesGitSubProvider(
			{ hooks: {} } as unknown as GitServiceContext,
			git,
			cache,
			{} as unknown as CliGitProviderInternal,
		);
	});

	test('unregisters a worktree the prune removed', async () => {
		run.onCall(0).resolves(exited(listing));
		run.onCall(1).resolves(exited(''));
		run.onCall(2).resolves(exited('worktree /repo\nHEAD abc\nbranch refs/heads/main\n'));

		await provider.pruneWorktrees(repoPath);

		sinon.assert.calledOnceWithExactly(unregisterRepoPath, '/wt');
	});

	test('a failed listing after the prune unregisters nothing', async () => {
		run.onCall(0).resolves(exited(listing));
		run.onCall(1).resolves(exited(''));
		run.onCall(2).resolves(failed());

		await provider.pruneWorktrees(repoPath);

		sinon.assert.notCalled(unregisterRepoPath);
	});
});

suite('WorktreesGitSubProvider.getWorktrees lock reason fallback', () => {
	let root: string;
	let provider: WorktreesGitSubProvider;
	let run: sinon.SinonStub;
	let lockReasonListed: boolean;

	setup(() => {
		root = mkdtempSync(join(tmpdir(), 'gitlens-lock-reason-'));
		run = sinon.stub();
		lockReasonListed = false;
		const cache = {
			getWorktrees: (repoPath: string, load: (p: string, c: unknown, s?: AbortSignal) => unknown) =>
				load(repoPath, { invalidate: () => {} }, undefined),
			evictCaches: () => {},
			getWorktreePaths: () => [],
		} as unknown as Cache;
		provider = new WorktreesGitSubProvider(
			{ hooks: {} } as unknown as GitServiceContext,
			{
				ensureSupports: () => Promise.resolve(),
				run: run,
				supports: (feature: string) => feature !== 'git:worktree:list:lock-reason' || lockReasonListed,
			} as unknown as Git,
			cache,
			{
				branches: { getBranches: () => Promise.resolve({ values: [] }) },
				notifyHost: () => {},
			} as unknown as CliGitProviderInternal,
		);
	});

	teardown(() => {
		rmSync(root, { recursive: true, force: true });
	});

	function addLinked(name: string, gitdir: string, reason?: string): string {
		const wt = join(root, name);
		mkdirSync(wt, { recursive: true });
		writeFileSync(join(wt, '.git'), `gitdir: ${gitdir}\n`);
		mkdirSync(join(root, 'admin', name), { recursive: true });
		if (reason != null) {
			writeFileSync(join(root, 'admin', name, 'locked'), reason);
		}
		return wt;
	}

	function listing(...paths: string[]): GitResult {
		return exited(
			`worktree /repo\nHEAD abc\nbranch refs/heads/main\n\n${paths
				.map(p => `worktree ${p}\nHEAD def\ndetached\nlocked\n`)
				.join('\n')}\n`,
		);
	}

	test('fills a bare lock from the admin dir, absolute or relative', async () => {
		const abs = addLinked('abs', join(root, 'admin', 'abs'), 'kepler:task:1\n');
		const rel = addLinked('rel', '../admin/rel', 'in use');
		run.resolves(listing(abs, rel));

		const worktrees = await provider.getWorktrees('/repo');

		assert.strictEqual(worktrees[1].locked, 'kepler:task:1');
		assert.strictEqual(worktrees[2].locked, 'in use');
	});

	test('keeps the branch name when filling a lock reason', async () => {
		const wt = addLinked('branched', join(root, 'admin', 'branched'), 'in use');
		run.resolves(
			exited(
				`worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree ${wt}\nHEAD def\nbranch refs/heads/feature/x\nlocked\n\n`,
			),
		);

		const worktrees = await provider.getWorktrees('/repo');

		assert.strictEqual(worktrees[1].locked, 'in use');
		assert.strictEqual(worktrees[1].branchName, 'feature/x');
	});

	test('reads no admin dir when git lists lock reasons itself', async () => {
		lockReasonListed = true;
		const abs = addLinked('abs', join(root, 'admin', 'abs'), 'kepler:task:1\n');
		run.resolves(listing(abs));

		const worktrees = await provider.getWorktrees('/repo');

		assert.strictEqual(worktrees[1].locked, true, 'a bare `locked` from git 2.31+ means no reason');
	});

	test('keeps a bare lock when the admin file is empty or missing', async () => {
		const empty = addLinked('empty', join(root, 'admin', 'empty'), '\n');
		const missing = addLinked('missing', join(root, 'admin', 'missing'));
		run.resolves(listing(empty, missing, join(root, 'nonexistent')));

		const worktrees = await provider.getWorktrees('/repo');

		assert.deepStrictEqual(
			worktrees.slice(1).map(w => w.locked),
			[true, true, true],
		);
	});
});

suite('WorktreesGitSubProvider.getWorktrees ignored worktrees', () => {
	const ignored = '/repo/.git/sync-tools-worktrees/x';
	// Inside the git dir, but under no folder the host registered: a user's own worktree
	const inGitDir = '/repo/.git/my-worktrees/x';
	const listing = exited(
		`worktree /repo\nHEAD abc\nbranch refs/heads/main\n\n${[ignored, inGitDir, '/wt']
			.map(p => `worktree ${p}\nHEAD def\ndetached\n`)
			.join('\n')}\n`,
	);

	/** `invalidated` counts the listings the shared cache was told not to keep */
	function createProvider(
		readIgnoredWorktreeRoots?: (repoPath: string) => Promise<readonly string[] | undefined>,
		invalidated?: { count: number },
	): WorktreesGitSubProvider {
		const cache = {
			getWorktrees: (repoPath: string, load: (p: string, c: unknown, s?: AbortSignal) => unknown) =>
				load(
					repoPath,
					{
						invalidate: () => {
							if (invalidated != null) {
								invalidated.count++;
							}
						},
					},
					undefined,
				),
			evictCaches: () => {},
			getWorktreePaths: () => [],
		} as unknown as Cache;
		return new WorktreesGitSubProvider(
			{ hooks: {} } as unknown as GitServiceContext,
			{
				ensureSupports: () => Promise.resolve(),
				run: () => Promise.resolve(listing),
				supports: () => Promise.resolve(true),
			} as unknown as Git,
			cache,
			{
				branches: { getBranches: () => Promise.resolve({ values: [] }) },
				notifyHost: () => {},
			} as unknown as CliGitProviderInternal,
			readIgnoredWorktreeRoots,
		);
	}

	test('leaves out a worktree under an ignored folder, but not one elsewhere in the git dir', async () => {
		const reads: string[] = [];
		const invalidated = { count: 0 };
		const provider = createProvider(repoPath => {
			reads.push(repoPath);
			return Promise.resolve(['/repo/.git/sync-tools-worktrees']);
		}, invalidated);

		const worktrees = await provider.getWorktrees('/repo');

		assert.deepStrictEqual(
			worktrees.map(w => w.path),
			['/repo', inGitDir, '/wt'],
		);
		assert.deepStrictEqual(reads, ['/repo']);
		assert.strictEqual(invalidated.count, 0);
	});

	test('lists every worktree, and keeps the list, when no folder is registered', async () => {
		const invalidated = { count: 0 };
		const worktrees = await createProvider(undefined, invalidated).getWorktrees('/repo');

		assert.deepStrictEqual(
			worktrees.map(w => w.path),
			['/repo', ignored, inGitDir, '/wt'],
		);
		assert.strictEqual(invalidated.count, 0);
	});

	test('lists every worktree, and keeps the list, when no registered folder applies', async () => {
		const invalidated = { count: 0 };
		const worktrees = await createProvider(() => Promise.resolve([]), invalidated).getWorktrees('/repo');

		assert.deepStrictEqual(
			worktrees.map(w => w.path),
			['/repo', ignored, inGitDir, '/wt'],
		);
		assert.strictEqual(invalidated.count, 0);
	});

	test("lists every worktree, but doesn't keep the list, when the registered folders can't be read", async () => {
		for (const read of [() => Promise.resolve(undefined), () => Promise.reject(new Error('unreadable'))]) {
			const invalidated = { count: 0 };
			const worktrees = await createProvider(read, invalidated).getWorktrees('/repo');

			assert.deepStrictEqual(
				worktrees.map(w => w.path),
				['/repo', ignored, inGitDir, '/wt'],
			);
			assert.strictEqual(invalidated.count, 1);
		}
	});
});

function localBranch(name: string, sha: string | undefined, worktree?: string | false, rebasing = false): GitBranch {
	return new GitBranch(
		'/repo',
		`refs/heads/${name}`,
		false,
		undefined,
		undefined,
		sha,
		undefined,
		typeof worktree === 'string' ? { path: worktree, isDefault: worktree === '/repo' } : worktree,
		false,
		rebasing,
	);
}

function porcelain(...entries: [path: string, sha: string, branch?: string][]): string {
	return `${entries
		.map(
			([path, sha, branch]) =>
				`worktree ${path}\nHEAD ${sha}\n${branch != null ? `branch refs/heads/${branch}` : 'detached'}\n`,
		)
		.join('\n')}\n`;
}

suite('WorktreesGitSubProvider.getWorktrees branch list consistency', () => {
	const main = localBranch('main', 'aaa', '/repo');
	const side = localBranch('side', 'bbb', '/wt');
	const other = localBranch('other', 'ccc', false);

	let onReset: sinon.SinonSpy;
	let getBranches: sinon.SinonStub;
	let notifyHost: sinon.SinonSpy;
	let invalidated: number;
	let knowsPaths: boolean;

	setup(() => {
		onReset = sinon.spy();
		getBranches = sinon.stub();
		notifyHost = sinon.spy();
		invalidated = 0;
		knowsPaths = true;
	});

	function read(listing: string): Promise<GitWorktree[]> {
		return createProvider(() => listing).getWorktrees('/repo');
	}

	function createProvider(listing: () => string): WorktreesGitSubProvider {
		const cache = {
			getWorktrees: (repoPath: string, load: (p: string, c: unknown, s?: AbortSignal) => unknown) =>
				load(repoPath, { invalidate: () => invalidated++ }, undefined),
			getWorktreePaths: () => [],
		} as unknown as Cache;
		const provider = new WorktreesGitSubProvider(
			{ hooks: { cache: { onReset: onReset } } } as unknown as GitServiceContext,
			{
				ensureSupports: () => Promise.resolve(),
				run: () => Promise.resolve(exited(listing())),
				supports: (feature: string) =>
					Promise.resolve(feature === 'git:for-each-ref:worktreePath' ? knowsPaths : true),
			} as unknown as Git,
			cache,
			{
				branches: { getBranches: getBranches },
				notifyHost: notifyHost,
			} as unknown as CliGitProviderInternal,
		);
		return provider;
	}

	function branchEvictions(): number {
		return onReset.getCalls().filter(c => c.args[0] === '/repo' && c.args[1] === 'branches').length;
	}

	test('a list that agrees with the branches evicts nothing', async () => {
		getBranches.resolves({ values: [main, side, other] });

		const worktrees = await read(porcelain(['/repo', 'aaa', 'main'], ['/wt', 'bbb', 'side']));

		sinon.assert.notCalled(onReset);
		sinon.assert.calledOnce(getBranches);
		assert.strictEqual(worktrees[1].branch, side);
	});

	test('a branch the list lacks refreshes the branches once and matches the fresh one', async () => {
		const fresh = localBranch('fresh', 'ccc', '/fresh');
		getBranches.onCall(0).resolves({ values: [main, side] });
		getBranches.onCall(1).resolves({ values: [main, side, fresh] });

		const worktrees = await read(
			porcelain(['/repo', 'aaa', 'main'], ['/wt', 'bbb', 'side'], ['/fresh', 'ccc', 'fresh']),
		);

		assert.strictEqual(branchEvictions(), 1);
		sinon.assert.calledTwice(getBranches);
		assert.strictEqual(worktrees[2].branch, fresh);
		assert.strictEqual(invalidated, 0);
	});

	test('an existing branch checked out in a new worktree refreshes the branches', async () => {
		getBranches.resolves({ values: [main, side, other] });

		await read(porcelain(['/repo', 'aaa', 'main'], ['/wt', 'bbb', 'side'], ['/new', 'ccc', 'other']));

		assert.strictEqual(branchEvictions(), 1);
		sinon.assert.calledTwice(getBranches);
		sinon.assert.calledWith(onReset, '/new', 'branch');
	});

	test('a branch that moved refreshes the branches', async () => {
		getBranches.resolves({ values: [main, side] });

		await read(porcelain(['/repo', 'aaa', 'main'], ['/wt', 'bbd', 'side']));

		assert.strictEqual(branchEvictions(), 1);
	});

	test("a worktree that switched branches also evicts that worktree's branch caches", async () => {
		getBranches.resolves({ values: [main, side, other] });

		await read(porcelain(['/repo', 'aaa', 'main'], ['/wt', 'ccc', 'other']));

		assert.strictEqual(branchEvictions(), 1);
		sinon.assert.calledWith(onReset, '/wt', 'branch');
		sinon.assert.neverCalledWith(onReset, '/repo', 'branch');
	});

	test('a worktree that went detached, or was removed, refreshes the branches', async () => {
		getBranches.resolves({ values: [main, side] });
		await read(porcelain(['/repo', 'aaa', 'main'], ['/wt', 'bbb']));
		assert.strictEqual(branchEvictions(), 1);
		sinon.assert.calledWith(onReset, '/wt', 'branch');

		onReset.resetHistory();
		await read(porcelain(['/repo', 'aaa', 'main']));
		assert.strictEqual(branchEvictions(), 1);
	});

	test('an unborn branch evicts nothing', async () => {
		// An empty repository's branch list is its current branch alone, with no sha
		getBranches.resolves({ values: [localBranch('main', undefined, '/repo')] });

		await read(
			porcelain(
				['/repo', '0000000000000000000000000000000000000000', 'main'],
				['/orphan', '0000000000000000000000000000000000000000', 'orphan'],
			),
		);

		sinon.assert.notCalled(onReset);
	});

	test('a rebasing branch, its worktree listed as detached, evicts nothing', async () => {
		getBranches.resolves({ values: [localBranch('feature', 'aaa', '/repo', true), side] });

		await read(porcelain(['/repo', 'aaa'], ['/wt', 'bbb', 'side']));

		sinon.assert.notCalled(onReset);
	});

	test("a bare repository's HEAD branch, which git places at the repository, evicts nothing", async () => {
		getBranches.resolves({ values: [localBranch('main', 'aaa', '/repo.git'), side] });

		await read(`worktree /repo.git\nbare\n\n${porcelain(['/wt', 'bbb', 'side'])}`);

		sinon.assert.notCalled(onReset);
	});

	test('a branch checked out in two worktrees, which git places at one, evicts nothing', async () => {
		getBranches.resolves({ values: [localBranch('main', 'aaa', '/dup'), side] });

		await read(porcelain(['/repo', 'aaa', 'main'], ['/wt', 'bbb', 'side'], ['/dup', 'aaa', 'main']));

		sinon.assert.notCalled(onReset);
	});

	test("a branch list git can't place in worktrees is checked by name and sha only", async () => {
		getBranches.resolves({ values: [localBranch('main', 'aaa'), localBranch('side', 'bbb')] });

		await read(porcelain(['/repo', 'aaa', 'main'], ['/wt', 'bbb', 'side']));

		sinon.assert.notCalled(onReset);
	});

	test('a branch read that rejected evicts nothing', async () => {
		getBranches.rejects(new Error('unreadable'));

		const worktrees = await read(porcelain(['/repo', 'aaa', 'main']));

		sinon.assert.notCalled(onReset);
		sinon.assert.calledOnce(getBranches);
		assert.strictEqual(worktrees[0].branchName, 'main');
	});

	test('a list still inconsistent after the refresh is kept, without a second refresh', async () => {
		getBranches.resolves({ values: [main] });

		const worktrees = await read(porcelain(['/repo', 'aaa', 'main'], ['/wt', 'bbb', 'side']));

		assert.strictEqual(branchEvictions(), 1);
		sinon.assert.calledTwice(getBranches);
		assert.strictEqual(worktrees[1].branch, undefined);
		assert.strictEqual(worktrees[1].branchName, 'side');
	});

	test("a refresh tells the host the branches moved, and a list that agrees doesn't", async () => {
		const fresh = localBranch('fresh', 'ccc', '/fresh');
		getBranches.resolves({ values: [main, side] });
		await read(porcelain(['/repo', 'aaa', 'main'], ['/wt', 'bbb', 'side']));
		sinon.assert.notCalled(notifyHost);

		getBranches.onCall(1).resolves({ values: [main, side] });
		getBranches.onCall(2).resolves({ values: [main, side, fresh] });
		await read(porcelain(['/repo', 'aaa', 'main'], ['/wt', 'bbb', 'side'], ['/fresh', 'ccc', 'fresh']));
		sinon.assert.calledOnceWithExactly(notifyHost, '/repo', ['heads']);
	});

	test('without git saying where branches are checked out, only a branch placed elsewhere counts as switched', async () => {
		knowsPaths = false;
		// Before `%(worktreepath)`, only the current branch is placed, at the main worktree
		const current = localBranch('main', 'aaa', '/repo');
		const unplaced = localBranch('side', 'old', undefined);
		getBranches.resolves({ values: [current, unplaced] });

		await read(porcelain(['/repo', 'aaa', 'main'], ['/wt', 'bbb', 'side']));

		assert.strictEqual(branchEvictions(), 1, 'the moved tip still proves the branches stale');
		assert.deepStrictEqual(
			onReset.getCalls().filter(c => c.args[1] === 'branch'),
			[],
			'no worktree is taken for switched for want of a placed branch',
		);
	});

	test('a disagreement a refresh leaves is not refreshed again until the list changes', async () => {
		getBranches.resolves({ values: [main] });
		let listing = porcelain(['/repo', 'aaa', 'main'], ['/wt', 'bbb', 'side']);
		const provider = createProvider(() => listing);

		await provider.getWorktrees('/repo');
		assert.strictEqual(branchEvictions(), 1);
		sinon.assert.calledTwice(getBranches);

		await provider.getWorktrees('/repo');
		assert.strictEqual(branchEvictions(), 1, 'the same list, still contradicted, refreshes nothing');
		sinon.assert.calledThrice(getBranches);

		listing = porcelain(['/repo', 'aaa', 'main'], ['/wt', 'ddd', 'side']);
		await provider.getWorktrees('/repo');
		assert.strictEqual(branchEvictions(), 2, 'a changed list is checked afresh');

		getBranches.resolves({ values: [main, localBranch('side', 'ddd', '/wt')] });
		await provider.getWorktrees('/repo');
		// The same list as the recorded disagreement, contradicted again
		getBranches.resolves({ values: [main] });
		await provider.getWorktrees('/repo');
		assert.strictEqual(branchEvictions(), 3, 'an agreement in between forgets the earlier disagreement');
	});

	test('a refresh that rejects keeps the first match, uncached', async () => {
		getBranches.onCall(0).resolves({ values: [main] });
		getBranches.onCall(1).rejects(new Error('unreadable'));

		const worktrees = await read(porcelain(['/repo', 'aaa', 'main'], ['/wt', 'bbb', 'side']));

		assert.strictEqual(worktrees[0].branch, main);
		assert.strictEqual(invalidated, 1);
	});
});

suite('WorktreesGitSubProvider.getWorktrees forced reads', () => {
	const repoPath = '/repo';
	const listing = porcelain(['/repo', 'aaa', 'main']);

	let cache: Cache;
	let provider: WorktreesGitSubProvider;
	let runs: { options: GitRunOptions; result: Deferred<GitResult> }[];

	setup(() => {
		cache = new Cache();
		cache.registerRepoPath(fileUri(repoPath), { uri: fileUri(`${repoPath}/.git`) });
		runs = [];
		provider = new WorktreesGitSubProvider(
			{ hooks: {} } as unknown as GitServiceContext,
			{
				ensureSupports: () => Promise.resolve(),
				run: (options: GitRunOptions) => {
					const result = defer<GitResult>();
					runs.push({ options: options, result: result });
					return result.promise;
				},
				supports: () => Promise.resolve(true),
			} as unknown as Git,
			cache,
			{
				branches: { getBranches: () => Promise.resolve({ values: [localBranch('main', 'aaa', '/repo')] }) },
			} as unknown as CliGitProviderInternal,
		);
	});

	teardown(() => {
		cache.dispose();
	});

	async function untilRuns(count: number): Promise<void> {
		for (let i = 0; i < 100 && runs.length < count; i++) {
			await new Promise(resolve => setImmediate(resolve));
		}
		assert.strictEqual(runs.length, count);
	}

	test("joins a pending read whose `git worktree list` hasn't started", async () => {
		const pending = provider.getWorktrees(repoPath);
		await untilRuns(1);

		const forced = provider.getWorktrees(repoPath, { force: true });
		runs[0].options.onSpawn?.();
		runs[0].result.fulfill(exited(listing));

		assert.strictEqual(await forced, await pending);
		assert.strictEqual(runs.length, 1);
	});

	test("a forced read joins a forced read made beside it, whose `git worktree list` hasn't started", async () => {
		const first = provider.getWorktrees(repoPath, { force: true });
		const second = provider.getWorktrees(repoPath, { force: true });
		await untilRuns(1);
		for (let i = 0; i < 5; i++) {
			await new Promise(resolve => setImmediate(resolve));
		}
		assert.strictEqual(runs.length, 1);

		runs[0].options.onSpawn?.();
		runs[0].result.fulfill(exited(listing));

		assert.strictEqual(await second, await first);
	});

	test('starts its own read once the pending one has started git', async () => {
		const pending = provider.getWorktrees(repoPath);
		await untilRuns(1);
		runs[0].options.onSpawn?.();

		const forced = provider.getWorktrees(repoPath, { force: true });
		await untilRuns(2);
		runs[0].result.fulfill(exited(listing));
		runs[1].result.fulfill(exited(porcelain(['/repo', 'aaa', 'main'], ['/wt', 'aaa'])));

		assert.strictEqual((await pending).length, 1);
		assert.strictEqual((await forced).length, 2);
	});

	test('an aborted forced read rejects without evicting the cached list', async () => {
		const first = provider.getWorktrees(repoPath);
		await untilRuns(1);
		runs[0].options.onSpawn?.();
		runs[0].result.fulfill(exited(listing));
		const cached = await first;

		const controller = new AbortController();
		controller.abort();
		await assert.rejects(provider.getWorktrees(repoPath, { force: true }, controller.signal), (ex: unknown) =>
			isCancellationError(ex),
		);

		assert.strictEqual(await provider.getWorktrees(repoPath), cached);
		assert.strictEqual(runs.length, 1);
	});
});
