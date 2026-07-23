import * as assert from 'assert';
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
