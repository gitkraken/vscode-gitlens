import * as assert from 'assert';
import * as sinon from 'sinon';
import { fileUri } from '@gitlens/utils/uri.js';
import { Cache } from '../cache.js';

suite('Cache.deleteGkConfig — branchOverviews invalidation', () => {
	let cache: Cache;

	setup(() => {
		cache = new Cache();
	});

	teardown(() => {
		cache.dispose();
	});

	test('without options: invalidates every branchOverviews entry for the affected ref', async () => {
		const repoPath = '/test/repo';
		let factoryCount = 0;
		const factory = () => {
			factoryCount++;
			return Promise.resolve(undefined);
		};

		// Populate two entries for the same ref but different mergeTargets.
		await cache.getBranchOverview(repoPath, 'main|origin/main', factory);
		await cache.getBranchOverview(repoPath, 'main|origin/develop', factory);
		assert.strictEqual(factoryCount, 2, 'both factories should have run on initial populate');

		// Trigger invalidation via a user-style write (no skip option).
		cache.deleteGkConfig(repoPath, 'branch.main.gk-merge-target-user');

		// Re-populate — both should miss and re-run their factories.
		await cache.getBranchOverview(repoPath, 'main|origin/main', factory);
		await cache.getBranchOverview(repoPath, 'main|origin/develop', factory);
		assert.strictEqual(factoryCount, 4, 'both entries should have been re-fetched after invalidation');
	});

	test("with skipInvalidation: ['branchOverviews']: preserves branchOverviews entries", async () => {
		const repoPath = '/test/repo';
		let factoryCount = 0;
		const factory = () => {
			factoryCount++;
			return Promise.resolve(undefined);
		};

		await cache.getBranchOverview(repoPath, 'main|origin/main', factory);
		await cache.getBranchOverview(repoPath, 'main|origin/develop', factory);
		assert.strictEqual(factoryCount, 2);

		// Tier 2 self-write path: skip the branchOverviews invalidation.
		cache.deleteGkConfig(repoPath, 'branch.main.gk-merge-target', { skipInvalidation: ['branchOverviews'] });

		// Re-fetch — both should hit the preserved cache entries.
		await cache.getBranchOverview(repoPath, 'main|origin/main', factory);
		await cache.getBranchOverview(repoPath, 'main|origin/develop', factory);
		assert.strictEqual(factoryCount, 2, 'cached entries should have been served without re-running factories');
	});

	test('skipBranchOverviewInvalidation does not block other refs from being preserved', async () => {
		const repoPath = '/test/repo';
		let factoryCount = 0;
		const factory = () => {
			factoryCount++;
			return Promise.resolve(undefined);
		};

		// Populate entries for two different refs.
		await cache.getBranchOverview(repoPath, 'main|origin/main', factory);
		await cache.getBranchOverview(repoPath, 'feature|origin/main', factory);
		assert.strictEqual(factoryCount, 2);

		// Wholesale-evict only `main|*` via a user-style write to that ref.
		cache.deleteGkConfig(repoPath, 'branch.main.gk-merge-target-user');

		await cache.getBranchOverview(repoPath, 'main|origin/main', factory);
		await cache.getBranchOverview(repoPath, 'feature|origin/main', factory);
		// `main` re-runs (was evicted); `feature` is preserved (different ref).
		assert.strictEqual(factoryCount, 3);
	});

	test('non-branchOverview keys do not trigger branchOverviews eviction', async () => {
		const repoPath = '/test/repo';
		let factoryCount = 0;
		const factory = () => {
			factoryCount++;
			return Promise.resolve(undefined);
		};

		await cache.getBranchOverview(repoPath, 'main|origin/main', factory);
		assert.strictEqual(factoryCount, 1);

		// Writes to keys that don't match `branchOverviewGkConfigKeyPattern` — e.g.
		// `gk-associated-issues` — must leave branchOverviews alone.
		cache.deleteGkConfig(repoPath, 'branch.main.gk-associated-issues');

		await cache.getBranchOverview(repoPath, 'main|origin/main', factory);
		assert.strictEqual(factoryCount, 1, 'unrelated gkConfig key should not invalidate branchOverviews');
	});
});

suite('Cache.clearCaches — branchMergedStatus', () => {
	let cache: Cache;

	setup(() => {
		cache = new Cache();
	});

	teardown(() => {
		cache.dispose();
	});

	test("clearCaches(repo, 'branches') preserves branchMergedStatus but still clears branchOverviews", async () => {
		const repoPath = '/test/repo';
		let mergedStatusCount = 0;
		let overviewCount = 0;
		const mergedStatusFactory = () => {
			mergedStatusCount++;
			return Promise.resolve({ merged: false } as const);
		};
		const overviewFactory = () => {
			overviewCount++;
			return Promise.resolve(undefined);
		};

		await cache.getBranchMergedStatus(repoPath, 'l:feature@sha1|l:main@sha2', mergedStatusFactory);
		await cache.getBranchOverview(repoPath, 'main|origin/main', overviewFactory);
		assert.strictEqual(mergedStatusCount, 1);
		assert.strictEqual(overviewCount, 1);

		cache.clearCaches(repoPath, 'branches');

		await cache.getBranchMergedStatus(repoPath, 'l:feature@sha1|l:main@sha2', mergedStatusFactory);
		await cache.getBranchOverview(repoPath, 'main|origin/main', overviewFactory);
		assert.strictEqual(mergedStatusCount, 1, 'branchMergedStatus is content-keyed, so it should be preserved');
		assert.strictEqual(overviewCount, 2, 'branchOverviews should still be cleared on a branches event');
	});
});

suite('Cache — baseBranchName lifetime', () => {
	const repoPath = '/test/repo';
	let cache: Cache;
	let factoryCount: number;
	const factory = () => {
		factoryCount++;
		return Promise.resolve('origin/main');
	};

	setup(() => {
		cache = new Cache();
		factoryCount = 0;
	});

	teardown(() => {
		cache.dispose();
	});

	test('the ceiling is absolute — frequent reads cannot extend it', async () => {
		// The distinction this pins: `accessTTL` resets on every read, so an entry being polled (a branch
		// card) would be held alive forever and never re-derive — which is precisely the case the ceiling
		// exists for. `createTTL` is measured from creation, so reads can't push it out.
		const clock = sinon.useFakeTimers({ now: Date.now(), shouldAdvanceTime: false });
		try {
			await cache.getBaseBranchName(repoPath, 'main', factory);
			assert.strictEqual(factoryCount, 1);

			// Read repeatedly, well inside the window. Each of these would reset a sliding TTL.
			for (let i = 0; i < 4; i++) {
				clock.tick(60 * 1000);
				await cache.getBaseBranchName(repoPath, 'main', factory);
				assert.strictEqual(factoryCount, 1, 'still inside the ceiling, so served from cache');
			}

			// Past the ceiling measured from CREATION, despite a read 60s ago. A sliding TTL would not have
			// expired here — that difference is the whole point of the assertion.
			clock.tick(2 * 60 * 1000);
			await cache.getBaseBranchName(repoPath, 'main', factory);
			assert.strictEqual(factoryCount, 2, 'the absolute ceiling must expire regardless of read frequency');
		} finally {
			clock.restore();
		}
	});

	test('survives tip movement — a commit cannot change a branch’s base', async () => {
		await cache.getBaseBranchName(repoPath, 'main', factory);
		assert.strictEqual(factoryCount, 1);

		// A commit rewrites `refs/heads/<branch>`, which classifies as `'heads'` alone. It does NOT touch
		// `.git/HEAD` — that still points at the same ref — so `'head'` is a checkout's signature, not a
		// commit's, and using it here would test the wrong operation.
		cache.onRepositoryChanged(repoPath, ['heads']);

		await cache.getBaseBranchName(repoPath, 'main', factory);
		assert.strictEqual(factoryCount, 1, 'a commit should not force a base-branch re-derivation');
	});

	test('is cleared on checkout — the reflog may now answer what it could not before', async () => {
		await cache.getBaseBranchName(repoPath, 'main', factory);
		assert.strictEqual(factoryCount, 1);

		// A checkout rewrites `.git/HEAD` (`['head', 'heads']`) and appends `checkout: moving from X to Y`
		// to the reflog — the entry the base derivation greps for when nothing is stored. A base cached as
		// "none" before that entry existed has to be allowed to re-derive.
		cache.onRepositoryChanged(repoPath, ['head', 'heads']);

		await cache.getBaseBranchName(repoPath, 'main', factory);
		assert.strictEqual(factoryCount, 2, 'a checkout should force a base-branch re-derivation');
	});

	test('is cleared on config changes — `vscode-merge-base` lives in .git/config', async () => {
		await cache.getBaseBranchName(repoPath, 'main', factory);
		assert.strictEqual(factoryCount, 1);

		cache.onRepositoryChanged(repoPath, ['config']);

		await cache.getBaseBranchName(repoPath, 'main', factory);
		assert.strictEqual(factoryCount, 2, 'a config change may have rewritten vscode-merge-base');
	});

	test('deleteBaseBranchName clears only the named ref', async () => {
		await cache.getBaseBranchName(repoPath, 'main', factory);
		await cache.getBaseBranchName(repoPath, 'feature', factory);
		assert.strictEqual(factoryCount, 2);

		cache.deleteBaseBranchName(repoPath, 'feature');

		await cache.getBaseBranchName(repoPath, 'main', factory);
		assert.strictEqual(factoryCount, 2, 'untouched refs keep their cached base');
		await cache.getBaseBranchName(repoPath, 'feature', factory);
		assert.strictEqual(factoryCount, 3, 'the named ref re-derives');
	});
});

suite('Cache.deleteGkConfig — baseBranchName invalidation', () => {
	let cache: Cache;

	setup(() => {
		cache = new Cache();
	});

	teardown(() => {
		cache.dispose();
	});

	test('writes to branch.<ref>.gk-merge-base invalidate baseBranchName for that ref', async () => {
		const repoPath = '/test/repo';
		let factoryCount = 0;
		const factory = () => {
			factoryCount++;
			return Promise.resolve('origin/main');
		};

		await cache.getBaseBranchName(repoPath, 'main', factory);
		assert.strictEqual(factoryCount, 1);

		cache.deleteGkConfig(repoPath, 'branch.main.gk-merge-base');

		await cache.getBaseBranchName(repoPath, 'main', factory);
		assert.strictEqual(factoryCount, 2, 'gk-merge-base write should re-trigger the base-branch factory');
	});

	test('writes to non-merge-base keys do NOT invalidate baseBranchName', async () => {
		const repoPath = '/test/repo';
		let factoryCount = 0;
		const factory = () => {
			factoryCount++;
			return Promise.resolve('origin/main');
		};

		await cache.getBaseBranchName(repoPath, 'main', factory);
		assert.strictEqual(factoryCount, 1);

		// gk-merge-target affects mergeTarget resolution but not the base branch.
		cache.deleteGkConfig(repoPath, 'branch.main.gk-merge-target');
		// gk-merge-target-user same as above.
		cache.deleteGkConfig(repoPath, 'branch.main.gk-merge-target-user');
		// gk-associated-issues is unrelated.
		cache.deleteGkConfig(repoPath, 'branch.main.gk-associated-issues');

		await cache.getBaseBranchName(repoPath, 'main', factory);
		assert.strictEqual(factoryCount, 1, 'non-base-branch keys should not affect baseBranchName cache');
	});

	test('gk-merge-base invalidation only affects the named ref', async () => {
		const repoPath = '/test/repo';
		let mainCount = 0;
		let featureCount = 0;
		const mainFactory = () => {
			mainCount++;
			return Promise.resolve('origin/main');
		};
		const featureFactory = () => {
			featureCount++;
			return Promise.resolve('origin/main');
		};

		await cache.getBaseBranchName(repoPath, 'main', mainFactory);
		await cache.getBaseBranchName(repoPath, 'feature', featureFactory);
		assert.strictEqual(mainCount, 1);
		assert.strictEqual(featureCount, 1);

		cache.deleteGkConfig(repoPath, 'branch.main.gk-merge-base');

		await cache.getBaseBranchName(repoPath, 'main', mainFactory);
		await cache.getBaseBranchName(repoPath, 'feature', featureFactory);
		assert.strictEqual(mainCount, 2, 'main should have been invalidated');
		assert.strictEqual(featureCount, 1, 'feature should have been preserved');
	});

	test("with skipInvalidation: ['baseBranchName']: preserves baseBranchName on a gk-merge-base write", async () => {
		const repoPath = '/test/repo';
		let factoryCount = 0;
		const factory = () => {
			factoryCount++;
			return Promise.resolve('origin/main');
		};

		await cache.getBaseBranchName(repoPath, 'main', factory);
		assert.strictEqual(factoryCount, 1);

		// Tier 3 self-write of just the baseBranchName cache (hypothetical isolated skip).
		cache.deleteGkConfig(repoPath, 'branch.main.gk-merge-base', { skipInvalidation: ['baseBranchName'] });

		await cache.getBaseBranchName(repoPath, 'main', factory);
		assert.strictEqual(factoryCount, 1, 'baseBranchName entry should have been preserved');
	});

	test("with skipInvalidation: ['branchOverviews', 'baseBranchName']: full Tier 3 self-write preserves both", async () => {
		const repoPath = '/test/repo';
		let baseFactoryCount = 0;
		let overviewFactoryCount = 0;
		const baseFactory = () => {
			baseFactoryCount++;
			return Promise.resolve('origin/main');
		};
		const overviewFactory = () => {
			overviewFactoryCount++;
			return Promise.resolve(undefined);
		};

		await cache.getBaseBranchName(repoPath, 'main', baseFactory);
		await cache.getBranchOverview(repoPath, 'main|origin/main', overviewFactory);
		assert.strictEqual(baseFactoryCount, 1);
		assert.strictEqual(overviewFactoryCount, 1);

		// Tier 3 self-write: the gk-merge-base write happens inside the same factory cycle that
		// just populated both caches, so both should be preserved.
		cache.deleteGkConfig(repoPath, 'branch.main.gk-merge-base', {
			skipInvalidation: ['branchOverviews', 'baseBranchName'],
		});

		await cache.getBaseBranchName(repoPath, 'main', baseFactory);
		await cache.getBranchOverview(repoPath, 'main|origin/main', overviewFactory);
		assert.strictEqual(baseFactoryCount, 1, 'baseBranchName entry should have been preserved');
		assert.strictEqual(overviewFactoryCount, 1, 'branchOverviews entry should have been preserved');
	});
});

suite('Cache — status generation', () => {
	const repoPath = '/test/repo';
	const otherPath = '/test/other';

	let cache: Cache;

	setup(() => {
		cache = new Cache();
	});

	teardown(() => {
		cache.dispose();
	});

	test('starts at 0 and advances monotonically', () => {
		assert.strictEqual(cache.getStatusGeneration(repoPath), 0, 'unknown repos start at generation 0');

		cache.incrementStatusGeneration(repoPath);
		assert.strictEqual(cache.getStatusGeneration(repoPath), 1);

		cache.incrementStatusGeneration(repoPath);
		assert.strictEqual(cache.getStatusGeneration(repoPath), 2);
	});

	test('is scoped per worktree path', () => {
		cache.incrementStatusGeneration(repoPath);

		assert.strictEqual(cache.getStatusGeneration(repoPath), 1);
		assert.strictEqual(cache.getStatusGeneration(otherPath), 0, 'sibling worktrees must not share a clock');
	});

	test('advances on repo changes that can change what `git status` reports', () => {
		// File list (index/head/heads/paused-op), untracked set (ignores/config), ahead/behind (remotes).
		for (const change of [
			'index',
			'head',
			'heads',
			'remotes',
			'ignores',
			'config',
			'merge',
			'rebase',
			'cherryPick',
			'revert',
			'pausedOp',
		]) {
			const before = cache.getStatusGeneration(repoPath);
			cache.onRepositoryChanged(repoPath, [change as never]);
			assert.ok(
				cache.getStatusGeneration(repoPath) > before,
				`'${change}' must advance the status clock (a pre-change \`git status\` can't answer a post-change read)`,
			);
		}
	});

	test('does not advance on repo changes that cannot affect `git status`', () => {
		// Tags never appear in `git status`; `lastFetched` (FETCH_HEAD) doesn't change its output.
		cache.onRepositoryChanged(repoPath, ['tags', 'lastFetched']);
		assert.strictEqual(cache.getStatusGeneration(repoPath), 0);
	});

	test('advances on a working-tree change (the channel an external discard arrives on)', () => {
		cache.onWorkingTreeChanged(repoPath);
		assert.strictEqual(cache.getStatusGeneration(repoPath), 1);
	});

	test("advances when 'status' caches are reset (the post-op hooks / user refresh)", () => {
		cache.clearCaches(repoPath, 'status');
		assert.strictEqual(cache.getStatusGeneration(repoPath), 1);

		// A repo-scoped reset must not disturb another worktree's clock
		assert.strictEqual(cache.getStatusGeneration(otherPath), 0);
	});

	test('a global reset advances every known worktree', () => {
		cache.registerRepoPath(fileUri(repoPath), { uri: fileUri(`${repoPath}/.git`) });
		cache.registerRepoPath(fileUri(otherPath), { uri: fileUri(`${otherPath}/.git`) });

		cache.clearCaches(undefined, 'status');

		assert.strictEqual(cache.getStatusGeneration(repoPath), 1);
		assert.strictEqual(cache.getStatusGeneration(otherPath), 1);
	});

	test('advances on unregister (close) so a reopened path cannot join a pre-close read', () => {
		cache.onRepositoryChanged(repoPath, ['index']); // generation 1
		cache.unregisterRepoPath(repoPath);
		assert.strictEqual(cache.getStatusGeneration(repoPath), 2, 'close must advance past the pre-close generation');
	});

	test('a global reset also advances an unregistered path that carries a generation', () => {
		// A secondary-worktree path can be incremented via its own watcher without ever being registered.
		cache.incrementStatusGeneration(otherPath); // generation 1, no registry entry
		cache.clearCaches(undefined, 'status');
		assert.strictEqual(
			cache.getStatusGeneration(otherPath),
			2,
			'union of registry + generation keys is incremented',
		);
	});
});

suite('Cache — tag-scoped invalidation', () => {
	const repoPath = '/test/repo';
	let cache: Cache;

	setup(() => {
		cache = new Cache();
	});

	teardown(() => {
		cache.dispose();
	});

	test('commitCount is cleared when tags change', async () => {
		let factoryCount = 0;
		const factory = () => {
			factoryCount++;
			return Promise.resolve(10);
		};

		await cache.commitCount.getOrCreate(repoPath, 'v1.0.0', factory);
		assert.strictEqual(factoryCount, 1);

		cache.clearCaches(repoPath, 'tags');

		await cache.commitCount.getOrCreate(repoPath, 'v1.0.0', factory);
		assert.strictEqual(factoryCount, 2, 'a force-moved or recreated tag must not serve its old count');
	});
});

suite('Cache — gkConfig watcher reconciliation', () => {
	const repoPath = '/test/repo';
	let cache: Cache;

	setup(() => {
		cache = new Cache();
	});

	teardown(() => {
		cache.dispose();
	});

	/**
	 * Mirrors the CLI config sub-provider's reconciler: re-reads via `getGkConfigMap` (a cache miss,
	 * since the watcher path clears it first) and hands the result to `reconcileGkConfigMap`. Returns
	 * a promise for the last reconcile's "changed" result, set synchronously so the test can await it
	 * right after `onRepositoryChanged` returns.
	 */
	function registerTestReconciler(nextMap: () => Map<string, string>): () => Promise<boolean> {
		let pending: Promise<boolean>;
		cache.setGkConfigReconciler((rp, priorSnapshot) => {
			pending = cache
				.getGkConfigMap(rp, () => nextMap())
				.then(freshMap => cache.reconcileGkConfigMap(rp, priorSnapshot, freshMap));
			// These tests exercise the reconcile cascade itself, so they always report success — the
			// coarse fallback is driven by the outcome and would otherwise mask what they assert.
			return pending.then(() => 'reconciled' as const);
		});
		return () => pending;
	}

	test('a gk-last-accessed-only change does not re-trigger baseBranchName', async () => {
		let baseFactoryCount = 0;
		const baseFactory = () => {
			baseFactoryCount++;
			return Promise.resolve('origin/main');
		};

		await cache.getGkConfigMap(repoPath, () =>
			Promise.resolve(
				new Map([
					['branch.main.gk-merge-base', 'origin/main'],
					['branch.main.gk-last-accessed', '2024-01-01T00:00:00.000Z'],
				]),
			),
		);
		await cache.getBaseBranchName(repoPath, 'main', baseFactory);
		assert.strictEqual(baseFactoryCount, 1);

		const result = registerTestReconciler(
			() =>
				new Map([
					['branch.main.gk-merge-base', 'origin/main'], // unchanged
					['branch.main.gk-last-accessed', '2024-06-01T00:00:00.000Z'], // changed, but not merge-relevant
				]),
		);
		cache.onRepositoryChanged(repoPath, ['gkConfig']);
		assert.strictEqual(await result(), false, 'no merge-relevant key changed');

		await cache.getBaseBranchName(repoPath, 'main', baseFactory);
		assert.strictEqual(baseFactoryCount, 1, 'a gk-last-accessed-only change must not re-derive the base branch');
	});

	test('a gk-merge-base change re-triggers baseBranchName', async () => {
		let baseFactoryCount = 0;
		const baseFactory = () => {
			baseFactoryCount++;
			return Promise.resolve('origin/main');
		};

		await cache.getGkConfigMap(repoPath, () =>
			Promise.resolve(new Map([['branch.main.gk-merge-base', 'origin/main']])),
		);
		await cache.getBaseBranchName(repoPath, 'main', baseFactory);
		assert.strictEqual(baseFactoryCount, 1);

		const result = registerTestReconciler(() => new Map([['branch.main.gk-merge-base', 'origin/develop']]));
		cache.onRepositoryChanged(repoPath, ['gkConfig']);
		assert.strictEqual(await result(), true, 'gk-merge-base changed externally');

		await cache.getBaseBranchName(repoPath, 'main', baseFactory);
		assert.strictEqual(baseFactoryCount, 2, 'an external gk-merge-base change must re-derive the base branch');
	});

	test('recordGkConfigWrite keeps a self-write from being diffed as an external change', async () => {
		let overviewFactoryCount = 0;
		const overviewFactory = () => {
			overviewFactoryCount++;
			return Promise.resolve(undefined);
		};

		await cache.getGkConfigMap(repoPath, () =>
			Promise.resolve(new Map([['branch.main.gk-merge-target', 'origin/main']])),
		);
		await cache.getBranchOverview(repoPath, 'main|origin/main', overviewFactory);
		assert.strictEqual(overviewFactoryCount, 1);

		// Simulate `setGkConfigCore`'s self-write bookkeeping happening before the watcher's event arrives.
		cache.recordGkConfigWrite(repoPath, 'branch.main.gk-merge-target', 'origin/develop');

		const result = registerTestReconciler(() => new Map([['branch.main.gk-merge-target', 'origin/develop']]));
		cache.onRepositoryChanged(repoPath, ['gkConfig']);
		assert.strictEqual(await result(), false, 'the write is already reflected in the snapshot, so it is not "new"');

		await cache.getBranchOverview(repoPath, 'main|origin/main', overviewFactory);
		assert.strictEqual(overviewFactoryCount, 1, 'branchOverviews should not be re-evicted for our own write');
	});

	test('with no prior snapshot (never read before), falls back to a coarse clear', async () => {
		let baseFactoryCount = 0;
		const baseFactory = () => {
			baseFactoryCount++;
			return Promise.resolve('origin/main');
		};
		let overviewFactoryCount = 0;
		const overviewFactory = () => {
			overviewFactoryCount++;
			return Promise.resolve(undefined);
		};

		// Populated via paths that never touch gk config (e.g. `vscode-merge-base`/reflog, non-gk
		// merge-target detection) — no gkConfig snapshot exists yet for this repo.
		await cache.getBaseBranchName(repoPath, 'main', baseFactory);
		await cache.getBranchOverview(repoPath, 'main|origin/main', overviewFactory);
		assert.strictEqual(baseFactoryCount, 1);
		assert.strictEqual(overviewFactoryCount, 1);

		const result = registerTestReconciler(() => new Map([['branch.main.gk-merge-target', 'origin/develop']]));
		cache.onRepositoryChanged(repoPath, ['gkConfig']);
		assert.strictEqual(await result(), true, 'no snapshot to compare against must be treated as changed');

		await cache.getBaseBranchName(repoPath, 'main', baseFactory);
		await cache.getBranchOverview(repoPath, 'main|origin/main', overviewFactory);
		assert.strictEqual(baseFactoryCount, 2, 'coarse fallback must clear baseBranchName');
		assert.strictEqual(overviewFactoryCount, 2, 'coarse fallback must clear branchOverviews');
	});

	test('with no reconciler registered, falls back to the coarse clear (e.g. the GitHub provider)', async () => {
		let baseFactoryCount = 0;
		const baseFactory = () => {
			baseFactoryCount++;
			return Promise.resolve('origin/main');
		};

		await cache.getGkConfigMap(repoPath, () =>
			Promise.resolve(new Map([['branch.main.gk-merge-base', 'origin/main']])),
		);
		await cache.getBaseBranchName(repoPath, 'main', baseFactory);
		assert.strictEqual(baseFactoryCount, 1);

		cache.onRepositoryChanged(repoPath, ['gkConfig']); // no reconciler registered

		await cache.getBaseBranchName(repoPath, 'main', baseFactory);
		assert.strictEqual(baseFactoryCount, 2, 'no reconciler means the coarse cascade must still run');
	});

	test("the reconcile's re-read must not join a bulk read that started before the change", async () => {
		let factoryCount = 0;
		let releaseInflight!: () => void;
		const inflightGate = new Promise<void>(resolve => (releaseInflight = resolve));

		// Establish the baseline, then evict as a write would.
		await cache.getGkConfigMap(repoPath, () => {
			factoryCount++;
			return Promise.resolve(new Map([['branch.main.gk-merge-base', 'origin/main']]));
		});
		cache.deleteGkConfigMap(repoPath);

		// A bulk read that started before the external write and is still running when the watcher fires,
		// so it can only ever see the pre-change content.
		const inflight = cache.getGkConfigMap(repoPath, async () => {
			factoryCount++;
			await inflightGate;
			return new Map([['branch.main.gk-merge-base', 'origin/main']]);
		});

		const result = registerTestReconciler(() => {
			factoryCount++;
			return new Map([['branch.main.gk-merge-base', 'origin/develop']]);
		});
		cache.onRepositoryChanged(repoPath, ['gkConfig']);

		releaseInflight();
		await inflight;

		assert.strictEqual(factoryCount, 3, 'the reconcile must spawn its own read rather than ride the in-flight one');
		assert.strictEqual(await result(), true, 'riding the pre-change read would diff it as unchanged');
	});

	test('an incidental read landing before the watcher event must not advance the reconcile baseline', async () => {
		await cache.getGkConfigMap(repoPath, () =>
			Promise.resolve(new Map([['branch.main.gk-merge-base', 'origin/main']])),
		);
		cache.deleteGkConfigMap(repoPath);

		// An unrelated caller (any `getGkConfig` lookup) reads between the external write hitting disk and
		// the watcher firing, so it already sees the new value.
		await cache.getGkConfigMap(repoPath, () =>
			Promise.resolve(new Map([['branch.main.gk-merge-base', 'origin/develop']])),
		);

		const result = registerTestReconciler(() => new Map([['branch.main.gk-merge-base', 'origin/develop']]));
		cache.onRepositoryChanged(repoPath, ['gkConfig']);

		assert.strictEqual(
			await result(),
			true,
			'the baseline must still be the pre-change value, or the change diffs against itself',
		);
	});
});

suite('Cache — gkConfig cascade across worktrees', () => {
	const repoPath = '/test/repo';
	const worktree = '/test/repo-wt';
	let cache: Cache;

	setup(() => {
		cache = new Cache();
		cache.registerRepoPath(fileUri(repoPath), { uri: fileUri(`${repoPath}/.git`) });
		cache.registerRepoPath(fileUri(worktree), {
			uri: fileUri(`${repoPath}/.git/worktrees/wt`),
			commonUri: fileUri(`${repoPath}/.git`),
		});
	});

	teardown(() => {
		cache.dispose();
	});

	test('a per-key cascade evicts a sibling worktree’s mapped branchOverviews entry', async () => {
		// Assert on the VALUE the worktree caller is served, not on factory invocations: the shared
		// commonPath entry is evicted either way, so a call-count assertion would pass even with the
		// worktree bucket left stale.
		let version = 'v1';
		const factory = () => Promise.resolve({ repoPath: repoPath, contributors: [], mergeTarget: version } as never);

		const first = (await cache.getBranchOverview(worktree, 'main|origin/main', factory)) as unknown as {
			mergeTarget: string;
		};
		assert.strictEqual(first.mergeTarget, 'v1');

		// An external gk-config change for that ref cascades per-key (no coarse clear any more).
		version = 'v2';
		cache.deleteGkConfig(repoPath, 'branch.main.gk-merge-target-user');

		const second = (await cache.getBranchOverview(worktree, 'main|origin/main', factory)) as unknown as {
			mergeTarget: string;
		};
		assert.strictEqual(second.mergeTarget, 'v2', 'the worktree entry must not survive the cascade');
	});
});

suite('Cache.getCloseGeneration', () => {
	const repoPath = '/test/repo';
	let cache: Cache;

	setup(() => {
		cache = new Cache();
	});

	teardown(() => {
		cache.dispose();
	});

	test('starts at zero for a path that was never registered', () => {
		assert.strictEqual(cache.getCloseGeneration(repoPath), 0);
	});

	test('advances on unregister so an async step can tell its target went away mid-flight', () => {
		const generation = cache.getCloseGeneration(repoPath);
		cache.unregisterRepoPath(repoPath);
		assert.notStrictEqual(cache.getCloseGeneration(repoPath), generation);
	});

	test('a sibling path closing does not disturb this one', () => {
		cache.unregisterRepoPath('/test/repo-feature');
		assert.strictEqual(cache.getCloseGeneration(repoPath), 0);
	});
});
