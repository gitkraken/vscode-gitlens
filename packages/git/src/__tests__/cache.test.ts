import * as assert from 'assert';
import * as sinon from 'sinon';
import { CancellationError, isCancellationError } from '@gitlens/utils/cancellation.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import type { PagedResult } from '@gitlens/utils/paging.js';
import { fileUri } from '@gitlens/utils/uri.js';
import type { BranchMetadataChange, CachedGitTypes, MergeTargetsChangeEvent } from '../cache.js';
import { Cache, resetDropsPendingRuns, shouldEvictBlameCacheEntry } from '../cache.js';
import type { GitBlame, ProgressiveGitBlame } from '../models/blame.js';
import type { BranchMetadata } from '../models/branch.js';
import { GitBranch } from '../models/branch.js';
import type { GitCommitLine } from '../models/commit.js';
import type { GitTag } from '../models/tag.js';
import { GitWorktree } from '../models/worktree.js';
import type { GitResult } from '../run.types.js';

function createCompletedBlame(lineCount: number): ProgressiveGitBlame {
	const blame: GitBlame = {
		repoPath: '/repo',
		authors: new Map(),
		commits: new Map(),
		lines: new Array<GitCommitLine>(lineCount),
	};
	return {
		current: blame,
		isComplete: true,
		completed: Promise.resolve(blame),
		onDidProgress: () => createDisposable(() => {}),
	};
}

suite('shouldEvictBlameCacheEntry', () => {
	test('retains completed blame up to 5000 lines', async () => {
		assert.strictEqual(await shouldEvictBlameCacheEntry(createCompletedBlame(5000)), false);
	});

	test('evicts completed blame over 5000 lines', async () => {
		assert.strictEqual(await shouldEvictBlameCacheEntry(createCompletedBlame(5001)), true);
	});

	test('evicts a progressive blame whose stream fails', async () => {
		const progressive = createCompletedBlame(0);
		const failed: ProgressiveGitBlame = {
			...progressive,
			completed: Promise.reject(new Error('stream failed')),
		};
		assert.strictEqual(await shouldEvictBlameCacheEntry(failed), true);
	});
});

suite('Cache.getResourceUsage', () => {
	test('reports retained entries rather than repository buckets for repo-scoped caches', () => {
		using cache = new Cache();
		cache.blame.set('/repo-a', 'one', Promise.resolve(undefined));
		cache.blame.set('/repo-a', 'two', Promise.resolve(undefined));
		cache.blame.set('/repo-b', 'three', Promise.resolve(undefined));

		assert.strictEqual(cache.getResourceUsage()['cache.blame.entries.count'], 3);
	});
});

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

suite('Cache.evictCaches vs clearCaches — in-flight shared entries', () => {
	let cache: Cache;

	setup(() => {
		cache = new Cache();
	});

	teardown(() => {
		cache.dispose();
	});

	function pagedBranches(name: string): PagedResult<GitBranch> {
		return { values: [{ name: name }] as unknown as GitBranch[] };
	}

	test('clearCaches lets a new caller join an in-flight shared entry (factory runs once)', async () => {
		const repoPath = '/test/repo';
		let factoryCount = 0;
		let resolveFirst!: (value: PagedResult<GitBranch>) => void;

		const first = cache.branches.getOrCreate(
			repoPath,
			() =>
				new Promise<PagedResult<GitBranch>>(resolve => {
					factoryCount++;
					resolveFirst = resolve;
				}),
		);

		// Soft-invalidate: the entry stays in the map and is still rideable while in flight.
		cache.clearCaches(repoPath, 'branches');

		const second = cache.branches.getOrCreate(repoPath, () => {
			factoryCount++;
			return Promise.resolve(pagedBranches('unused'));
		});

		resolveFirst(pagedBranches('shared'));

		const [firstResult, secondResult] = await Promise.all([first, second]);
		assert.strictEqual(factoryCount, 1, 'clearCaches should let the new caller join the in-flight factory');
		assert.strictEqual(firstResult, secondResult, 'both callers should observe the same shared result');
	});

	test("evictCaches hard-evicts so a new caller does not join, and the first caller's promise still resolves", async () => {
		const repoPath = '/test/repo';
		let factoryCount = 0;
		let resolveFirst!: (value: PagedResult<GitBranch>) => void;
		const firstValue = pagedBranches('first');
		const secondValue = pagedBranches('second');

		const first = cache.branches.getOrCreate(
			repoPath,
			() =>
				new Promise<PagedResult<GitBranch>>(resolve => {
					factoryCount++;
					resolveFirst = resolve;
				}),
		);

		// Hard-delete: a new caller must spawn its own factory rather than ride the in-flight one.
		cache.evictCaches(repoPath, 'branches');

		const second = cache.branches.getOrCreate(repoPath, () => {
			factoryCount++;
			return Promise.resolve(secondValue);
		});

		resolveFirst(firstValue);

		const [firstResult, secondResult] = await Promise.all([first, second]);
		assert.strictEqual(factoryCount, 2, 'evictCaches should force the new caller to run its own factory');
		assert.strictEqual(firstResult, firstValue, "the first caller's promise still resolves with its own value");
		assert.strictEqual(secondResult, secondValue);
	});
});

suite('Cache — aheadOfBaseConfigKey per checkout', () => {
	const repoPath = '/test/repo';
	const worktree = '/test/repo-wt';
	let cache: Cache;
	let reads: number;

	setup(() => {
		cache = new Cache();
		cache.registerRepoPath(fileUri(repoPath), { uri: fileUri(`${repoPath}/.git`) });
		cache.registerRepoPath(fileUri(worktree), {
			uri: fileUri(`${repoPath}/.git/worktrees/wt`),
			commonUri: fileUri(`${repoPath}/.git`),
		});
		reads = 0;
	});

	teardown(() => {
		cache.dispose();
	});

	function read(path: string): Promise<string | undefined> {
		return cache.getAheadOfBaseConfigKey(path, () => `config ${++reads}`);
	}

	test('each checkout reads once and then stays warm', async () => {
		assert.strictEqual(await read(repoPath), 'config 1');
		assert.strictEqual(await read(worktree), 'config 2');
		assert.strictEqual(await read(repoPath), 'config 1');
		assert.strictEqual(await read(worktree), 'config 2');
		assert.strictEqual(reads, 2);
	});

	const changes: [string, (c: Cache) => void][] = [
		['a watcher config change from the main checkout', c => c.onRepositoryChanged(repoPath, ['config'])],
		['a watcher config change from the linked worktree', c => c.onRepositoryChanged(worktree, ['config'])],
		["core's own config write in the linked worktree", c => c.evictCaches(worktree, 'config')],
		["clearCaches(repoPath, 'config')", c => c.clearCaches(repoPath, 'config')],
		['a full clear of the linked worktree', c => c.clearCaches(worktree)],
	];
	changes.forEach(([name, change]) => {
		test(`${name} evicts every checkout's read`, async () => {
			await read(repoPath);
			await read(worktree);
			change(cache);
			assert.strictEqual(await read(repoPath), 'config 3');
			assert.strictEqual(await read(worktree), 'config 4');
		});
	});

	test('a global reset drops the shared read', async () => {
		await read(worktree);
		cache.reset();
		assert.strictEqual(await read(repoPath), 'config 2');
	});

	test('a config change never lets a later read join a read started before it', async () => {
		let resolveFirst!: (value: string) => void;
		const first = cache.getAheadOfBaseConfigKey(
			repoPath,
			() =>
				new Promise<string>(resolve => {
					reads++;
					resolveFirst = resolve;
				}),
		);

		// A watcher report would share an in-flight read of any other shared key
		cache.onRepositoryChanged(worktree, ['config']);
		const second = read(repoPath);
		resolveFirst('before');

		assert.strictEqual(await first, 'before');
		assert.strictEqual(await second, 'config 2');
		assert.strictEqual(await read(repoPath), 'config 2', 'the old settle cannot replace the new entry');
		assert.strictEqual(reads, 2);
	});

	test('HEAD invalidation clears only its checkout, including conditional branch config', async () => {
		await read(repoPath);
		await read(worktree);
		cache.onRepositoryChanged(worktree, ['head']);
		assert.strictEqual(await read(repoPath), 'config 1');
		assert.strictEqual(await read(worktree), 'config 3');
	});

	test('registration and a changed mapping cannot reuse an earlier fingerprint', async () => {
		cache.unregisterRepoPath(worktree);
		await read(worktree);
		cache.registerRepoPath(fileUri(worktree), {
			uri: fileUri(`${repoPath}/.git/worktrees/wt`),
			commonUri: fileUri(`${repoPath}/.git`),
		});
		assert.strictEqual(await read(worktree), 'config 2');
		cache.registerRepoPath(fileUri(worktree), {
			uri: fileUri('/other/.git/worktrees/wt'),
			commonUri: fileUri('/other/.git'),
		});
		assert.strictEqual(await read(worktree), 'config 3');
		assert.ok(!cache.getWorktreePaths(repoPath).includes(worktree));
	});

	test('closing and reopening a checkout does not join its old read or lose its cancellation', async () => {
		const controller = new AbortController();
		let oldSignal: AbortSignal | undefined;
		const old = cache.getAheadOfBaseConfigKey(
			worktree,
			(_path, _cacheable, signal) => {
				oldSignal = signal;
				return new Promise((_resolve, reject) =>
					signal!.addEventListener('abort', () => reject(new CancellationError()), { once: true }),
				);
			},
			controller.signal,
		);
		cache.unregisterRepoPath(worktree);
		cache.registerRepoPath(fileUri(worktree), {
			uri: fileUri(`${repoPath}/.git/worktrees/wt`),
			commonUri: fileUri(`${repoPath}/.git`),
		});
		assert.strictEqual(await read(worktree), 'config 1');
		controller.abort();
		await assert.rejects(old, isCancellationError);
		assert.strictEqual(oldSignal?.aborted, true);
		assert.strictEqual(await read(worktree), 'config 1');
	});

	test('one canceled waiter leaves the same-checkout survivor and cached result alive', async () => {
		const controller = new AbortController();
		let release!: (value: string) => void;
		let sharedSignal: AbortSignal | undefined;
		const first = cache.getAheadOfBaseConfigKey(
			worktree,
			(_path, _cacheable, signal) => {
				sharedSignal = signal;
				return new Promise<string>(resolve => {
					release = resolve;
				});
			},
			controller.signal,
		);
		const survivor = read(worktree);
		controller.abort();
		await assert.rejects(first, isCancellationError);
		assert.strictEqual(sharedSignal?.aborted, false);
		release('survived');
		assert.strictEqual(await survivor, 'survived');
		assert.strictEqual(await read(worktree), 'survived');
		assert.strictEqual(reads, 0);
	});

	(['config', 'head'] as const).forEach(change => {
		test(`${change} cannot pair a fresh fingerprint with an older in-flight base command`, async () => {
			const command =
				'git rev-parse --verify --quiet --symbolic-full-name --abbrev-ref --end-of-options main@{u}';
			let release!: (value: GitResult) => void;
			const old = cache.gitResults.getOrCreate(
				worktree,
				command,
				() =>
					new Promise<GitResult>(resolve => {
						release = resolve;
					}),
			);
			cache.onRepositoryChanged(worktree, [change]);
			const freshKey = await read(worktree);
			let freshRead = false;
			const freshResult: GitResult = {
				stdout: 'alternate/main',
				stderr: '',
				exitCode: 0,
				completion: { status: 'exited', code: 0 },
			};
			const newer = cache.gitResults.getOrCreate(worktree, command, async () => {
				freshRead = true;
				return freshResult;
			});
			release({ ...freshResult, stdout: 'origin/main' });
			assert.strictEqual(freshKey, 'config 1');
			assert.strictEqual((await old).stdout, 'origin/main');
			assert.strictEqual(freshRead, true, 'a post-event base read must not join pre-event work');
			assert.strictEqual((await newer).stdout, 'alternate/main');
			assert.strictEqual(
				(await cache.gitResults.getOrCreate(worktree, command, async () => freshResult)).stdout,
				'alternate/main',
			);
		});
	});

	const lifetimes = [
		'linked close',
		'main close with peer',
		'last close',
		'last linked close',
		'first registration',
		'remapping',
	] as const;
	lifetimes.forEach(lifetime => {
		test(`${lifetime} retires pending config and base commands together`, async () => {
			const path = lifetime === 'main close with peer' || lifetime === 'last close' ? repoPath : worktree;
			const peer = path === repoPath ? worktree : repoPath;
			const command = 'git rev-parse main@{u}';
			const result: GitResult = {
				stdout: 'alternate/main',
				stderr: '',
				exitCode: 0,
				completion: { status: 'exited', code: 0 },
			};
			if (lifetime === 'first registration') {
				cache.unregisterRepoPath(path);
			}
			if (lifetime === 'last close' || lifetime === 'last linked close') {
				cache.unregisterRepoPath(peer);
			}
			await cache.gitResults.getOrCreate(peer, command, async () => result);
			let releaseKey!: (value: string) => void;
			let releaseCommand!: (value: GitResult) => void;
			const oldKey = cache.getAheadOfBaseConfigKey(
				path,
				() =>
					new Promise<string>(resolve => {
						releaseKey = resolve;
					}),
			);
			const oldCommand = cache.gitResults.getOrCreate(
				path,
				command,
				() =>
					new Promise<GitResult>(resolve => {
						releaseCommand = resolve;
					}),
			);
			if (lifetime !== 'first registration' && lifetime !== 'remapping') {
				cache.unregisterRepoPath(path);
			}
			if (lifetime === 'last linked close') {
				assert.strictEqual(
					cache.gitResults.get(repoPath, command),
					undefined,
					'the final owner also detaches the common bucket',
				);
			}
			const common = lifetime === 'remapping' ? '/other' : repoPath;
			cache.registerRepoPath(
				fileUri(path),
				path === common
					? { uri: fileUri(`${common}/.git`) }
					: {
							uri: fileUri(`${common}/.git/worktrees/wt`),
							commonUri: fileUri(`${common}/.git`),
						},
			);
			const freshKey = await cache.getAheadOfBaseConfigKey(path, () => 'config-B');
			let commandReads = 0;
			const freshCommand = cache.gitResults.getOrCreate(path, command, async () => {
				commandReads++;
				return result;
			});
			releaseKey('config-A');
			releaseCommand({ ...result, stdout: 'origin/main' });
			assert.strictEqual(await oldKey, 'config-A');
			assert.strictEqual((await oldCommand).stdout, 'origin/main');
			assert.strictEqual(freshKey, 'config-B');
			assert.strictEqual(
				(await freshCommand).stdout,
				'alternate/main',
				'a fresh key must not attest a pre-lifecycle command',
			);
			assert.strictEqual(commandReads, 1);
			assert.strictEqual(await cache.getAheadOfBaseConfigKey(path, () => 'unexpected'), 'config-B');
			assert.strictEqual(
				(
					await cache.gitResults.getOrCreate(path, command, async () => {
						throw new Error('lost new owner');
					})
				).stdout,
				'alternate/main',
			);
			if (lifetime !== 'last close' && lifetime !== 'last linked close') {
				assert.strictEqual(
					await cache.gitResults.getOrCreate(peer, command, async () => {
						throw new Error('peer cooled');
					}),
					result,
				);
			}
		});
	});

	[repoPath, worktree].forEach(path => {
		test(`closing ${path} retains old command waiter cancellation without poisoning its replacement`, async () => {
			const controller = new AbortController();
			let signal: AbortSignal | undefined;
			let release!: (value: GitResult) => void;
			const command = 'git rev-parse main@{u}';
			const factory = (_cacheable: unknown, cancellation?: AbortSignal): Promise<GitResult> => {
				signal = cancellation;
				return new Promise(resolve => {
					release = resolve;
				});
			};
			const canceled = cache.gitResults.getOrCreate(path, command, factory, { cancellation: controller.signal });
			const survivor = cache.gitResults.getOrCreate(path, command, factory);
			cache.unregisterRepoPath(path);
			const fresh: GitResult = {
				stdout: 'fresh',
				stderr: '',
				exitCode: 0,
				completion: { status: 'exited', code: 0 },
			};
			const replacement = cache.gitResults.getOrCreate(path, command, async () => fresh);
			controller.abort();
			await assert.rejects(canceled, isCancellationError);
			assert.strictEqual(signal?.aborted, false, 'the surviving old waiter still owns its aggregate');
			release({ ...fresh, stdout: 'old' });
			assert.strictEqual((await survivor).stdout, 'old');
			assert.strictEqual(await replacement, fresh);
			assert.strictEqual(
				await cache.gitResults.getOrCreate(path, command, async () => {
					throw new Error('replacement lost');
				}),
				fresh,
			);
		});
	});

	test('a detached command still aborts when its last old waiter cancels', async () => {
		const controller = new AbortController();
		let oldSignal: AbortSignal | undefined;
		const old = cache.gitResults.getOrCreate(
			worktree,
			'git old',
			(_cacheable, signal) => {
				oldSignal = signal;
				return new Promise<GitResult>((_resolve, reject) => {
					signal!.addEventListener('abort', () => reject(new CancellationError()), { once: true });
				});
			},
			{ cancellation: controller.signal },
		);
		cache.unregisterRepoPath(worktree);
		controller.abort();
		await assert.rejects(old, isCancellationError);
		assert.strictEqual(oldSignal?.aborted, true);
	});

	test('an unchanged registration preserves warm checkout and common commands', async () => {
		const result: GitResult = {
			stdout: 'warm',
			stderr: '',
			exitCode: 0,
			completion: { status: 'exited', code: 0 },
		};
		await read(worktree);
		await cache.gitResults.getOrCreate(worktree, 'git checkout-command', async () => result);
		await cache.gitResults.getOrCreate(repoPath, 'git shared-command', async () => result);
		cache.registerRepoPath(fileUri(worktree), {
			uri: fileUri(`${repoPath}/.git/worktrees/wt`),
			commonUri: fileUri(`${repoPath}/.git`),
		});
		assert.strictEqual(await read(worktree), 'config 1');
		assert.strictEqual(
			await cache.gitResults.getOrCreate(worktree, 'git checkout-command', async () => {
				throw new Error('checkout cooled');
			}),
			result,
		);
		cache.unregisterRepoPath(worktree);
		assert.strictEqual(
			await cache.gitResults.getOrCreate(repoPath, 'git shared-command', async () => {
				throw new Error('shared command cooled');
			}),
			result,
		);
	});

	test('a failed read is not kept', async () => {
		const failed = await cache.getAheadOfBaseConfigKey(repoPath, (_commonPath, cacheable) => {
			reads++;
			cacheable.invalidate();
			return undefined;
		});
		assert.strictEqual(failed, undefined);
		assert.strictEqual(await read(worktree), 'config 2');
	});

	test('unregistering a worktree keeps the sibling warm', async () => {
		await read(repoPath);

		cache.unregisterRepoPath(worktree);
		assert.strictEqual(await read(repoPath), 'config 1', 'the main checkout still depends on it');

		cache.unregisterRepoPath(repoPath);
		assert.strictEqual(await read(repoPath), 'config 2');
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

	test('logShas is cleared when tags change', async () => {
		let factoryCount = 0;
		const factory = () => {
			factoryCount++;
			return Promise.resolve([]);
		};

		await cache.logShas.getOrCreate(repoPath, 'feat', factory);
		assert.strictEqual(factoryCount, 1);

		cache.clearCaches(repoPath, 'tags');

		await cache.logShas.getOrCreate(repoPath, 'feat', factory);
		assert.strictEqual(factoryCount, 2, 'a list excluding tags must not survive a tag create or delete');
	});

	test('leftRightCommitCount and mergeBase are cleared when tags change', async () => {
		let countReads = 0;
		let mergeBaseReads = 0;
		const countFactory = () => {
			countReads++;
			return Promise.resolve({ left: 0, right: 1 });
		};
		const mergeBaseFactory = () => {
			mergeBaseReads++;
			return Promise.resolve('abc123');
		};

		await cache.leftRightCommitCount.getOrCreate(repoPath, 'v1.0.0...HEAD', countFactory);
		await cache.mergeBase.getOrCreate(repoPath, 'v1.0.0:HEAD', mergeBaseFactory);
		await cache.leftRightCommitCount.getOrCreate(repoPath, 'v1.0.0...HEAD', countFactory);
		await cache.mergeBase.getOrCreate(repoPath, 'v1.0.0:HEAD', mergeBaseFactory);
		assert.strictEqual(countReads, 1);
		assert.strictEqual(mergeBaseReads, 1);

		cache.clearCaches(repoPath, 'tags');

		await cache.leftRightCommitCount.getOrCreate(repoPath, 'v1.0.0...HEAD', countFactory);
		await cache.mergeBase.getOrCreate(repoPath, 'v1.0.0:HEAD', mergeBaseFactory);
		assert.strictEqual(countReads, 2, 'a force-moved tag must not serve the count taken against its old commit');
		assert.strictEqual(mergeBaseReads, 2, 'a force-moved tag must not serve its old fork point');
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
	 * Mirrors the CLI config sub-provider's reconciler for a file that changed since the map was read: evicts the
	 * map as the change is reported, re-reads via `getGkConfigMap` (a cache miss) and hands the result to
	 * `reconcileGkConfigMap`. Returns a promise for the last reconcile's "changed" result, set synchronously so the
	 * test can await it right after `onRepositoryChanged` returns.
	 */
	function registerTestReconciler(
		nextMap: () => Map<string, string>,
		options?: { keepMap?: boolean },
	): () => Promise<boolean> {
		let pending: Promise<boolean>;
		cache.setGkConfigReconciler((rp, priorSnapshot) => {
			if (!options?.keepMap) {
				cache.deleteGkConfigMap(rp);
			}
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
		assert.strictEqual(await result(), true, 'the activity stamp changed the branches, not a merge-relevant key');

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

	test('a reconciler that keeps the map still diffs it: an incidental read already holding the change', async () => {
		let factoryCount = 0;
		await cache.getGkConfigMap(repoPath, () => {
			factoryCount++;
			return Promise.resolve(new Map([['branch.main.gk-merge-base', 'origin/main']]));
		});
		cache.deleteGkConfigMap(repoPath);

		// Read after the external write, so the reconciler finds the file unchanged since and keeps this map
		await cache.getGkConfigMap(repoPath, () => {
			factoryCount++;
			return Promise.resolve(new Map([['branch.main.gk-merge-base', 'origin/develop']]));
		});

		const result = registerTestReconciler(
			() => {
				factoryCount++;
				return new Map([['branch.main.gk-merge-base', 'origin/develop']]);
			},
			{ keepMap: true },
		);
		cache.onRepositoryChanged(repoPath, ['gkConfig']);

		assert.strictEqual(await result(), true, 'the kept map is diffed against the pre-change baseline');
		assert.strictEqual(factoryCount, 2, 'the report leaves the map to the reconciler, which kept it');
	});

	test('a reconciler that throws before returning evicts the map and falls back to the coarse clear', async () => {
		let factoryCount = 0;
		const read = () =>
			cache.getGkConfigMap(repoPath, () => {
				factoryCount++;
				return Promise.resolve(new Map([['branch.main.gk-merge-base', 'origin/main']]));
			});
		await read();
		const events: MergeTargetsChangeEvent[] = [];
		cache.onDidChangeMergeTargets(e => events.push(e));

		cache.setGkConfigReconciler(() => {
			throw new Error('reconciler failed');
		});
		cache.onRepositoryChanged(repoPath, ['gkConfig']);
		await read();

		assert.strictEqual(factoryCount, 2, 'the pre-change map must not keep being served');
		assert.deepStrictEqual(events, [{ repoPath: repoPath, refs: undefined }]);
	});

	test('with no reconciler registered, the report evicts the map', async () => {
		let factoryCount = 0;
		const read = () =>
			cache.getGkConfigMap(repoPath, () => {
				factoryCount++;
				return Promise.resolve(new Map([['branch.main.gk-merge-base', 'origin/main']]));
			});
		await read();

		cache.onRepositoryChanged(repoPath, ['gkConfig']);
		await read();

		assert.strictEqual(factoryCount, 2);
	});

	suite('branch metadata', () => {
		let metadataFactoryCount: number;
		let events: MergeTargetsChangeEvent[];
		let deleteBranchMetadata: sinon.SinonSpy<[repoPath: string], void>;
		let patchBranchMetadata: sinon.SinonSpy<[repoPath: string, changes: readonly BranchMetadataChange[]], void>;

		const initial: [string, string][] = [
			['branch.main.gk-merge-target', 'origin/main'],
			['branch.main.gk-last-accessed', '2026-10-01T00:00:00.000Z'],
		];

		/** Seeds the reconcile baseline and a cached branch metadata map, as a warm branch read leaves them */
		async function seedBranchMetadata(): Promise<BranchMetadata> {
			await cache.getGkConfigMap(repoPath, () => Promise.resolve(new Map(initial)));
			const metadata = (await readBranchMetadata()).get('main');
			assert.strictEqual(metadataFactoryCount, 1);
			assert.ok(metadata);
			return metadata;
		}

		/** Mirrors the CLI factory: one fresh object per branch with any metadata (here only `main`) */
		function readBranchMetadata(): Promise<Map<string, BranchMetadata>> {
			return cache.getBranchMetadataMap(repoPath, () => {
				metadataFactoryCount++;
				return new Map([['main', { lastAccessedAt: '2026-10-01T00:00:00.000Z' }]]);
			});
		}

		setup(() => {
			metadataFactoryCount = 0;
			events = [];
			cache.onDidChangeMergeTargets(e => events.push(e));
			deleteBranchMetadata = sinon.spy(cache, 'deleteBranchMetadata');
			patchBranchMetadata = sinon.spy(cache, 'patchBranchMetadata');
		});

		teardown(() => {
			sinon.restore();
		});

		test('a patch updates the cached metadata object in place and evicts nothing', async () => {
			const metadata = await seedBranchMetadata();

			cache.patchBranchMetadata(repoPath, [
				{ branch: 'main', key: 'gk-last-accessed', value: '2026-10-05T00:00:00.000Z' },
				{ branch: 'main', key: 'gk-last-modified', value: '2026-10-05T00:00:00.000Z' },
			]);

			assert.strictEqual(deleteBranchMetadata.callCount, 0);
			const reread = (await readBranchMetadata()).get('main');
			assert.strictEqual(metadataFactoryCount, 1, 'served from the cache');
			assert.strictEqual(reread, metadata, 'the same object every cached branch holds');
			assert.deepStrictEqual(metadata, {
				lastAccessedAt: '2026-10-05T00:00:00.000Z',
				lastModifiedAt: '2026-10-05T00:00:00.000Z',
			});
		});

		test('a patch stores a value as a fresh read would', async () => {
			const metadata = await seedBranchMetadata();

			cache.patchBranchMetadata(repoPath, [{ branch: 'main', key: 'gk-disposition', value: 'starred' }]);
			assert.strictEqual(metadata.disposition, 'starred');

			cache.patchBranchMetadata(repoPath, [{ branch: 'main', key: 'gk-disposition', value: 'bogus' }]);
			assert.ok(!('disposition' in metadata), 'a fresh read ignores an unknown disposition');
			assert.strictEqual(deleteBranchMetadata.callCount, 0);
		});

		test('a removal deletes the field', async () => {
			const metadata = await seedBranchMetadata();

			cache.patchBranchMetadata(repoPath, [{ branch: 'main', key: 'gk-last-accessed', value: undefined }]);

			assert.ok(!('lastAccessedAt' in metadata));
			assert.strictEqual(deleteBranchMetadata.callCount, 0);
		});

		test('a patch with nothing cached does nothing', async () => {
			cache.patchBranchMetadata(repoPath, [
				{ branch: 'main', key: 'gk-last-accessed', value: '2026-10-05T00:00:00.000Z' },
			]);

			assert.strictEqual(deleteBranchMetadata.callCount, 0);
			await readBranchMetadata();
			assert.strictEqual(metadataFactoryCount, 1);
		});

		test('a patch while the map is still being read evicts it', async () => {
			let resolveRead!: (map: Map<string, BranchMetadata>) => void;
			const inFlight = cache.getBranchMetadataMap(repoPath, () => {
				metadataFactoryCount++;
				return new Promise<Map<string, BranchMetadata>>(resolve => {
					resolveRead = resolve;
				});
			});

			cache.patchBranchMetadata(repoPath, [
				{ branch: 'main', key: 'gk-last-accessed', value: '2026-10-05T00:00:00.000Z' },
			]);
			assert.strictEqual(deleteBranchMetadata.callCount, 1, 'the read may predate the write');

			resolveRead(new Map([['main', { lastAccessedAt: '2026-10-01T00:00:00.000Z' }]]));
			await inFlight;
			await readBranchMetadata();
			assert.strictEqual(metadataFactoryCount, 2, 'the next read is not joined to the one in flight');
		});

		test("a branch's first stamp evicts once, since its cached branches hold no metadata to share", async () => {
			await seedBranchMetadata();

			cache.patchBranchMetadata(repoPath, [
				{ branch: 'main', key: 'gk-last-accessed', value: '2026-10-05T00:00:00.000Z' },
				{ branch: 'feature', key: 'gk-last-accessed', value: '2026-10-05T00:00:00.000Z' },
				{ branch: 'other', key: 'gk-last-accessed', value: '2026-10-05T00:00:00.000Z' },
			]);

			assert.strictEqual(deleteBranchMetadata.callCount, 1);
			await readBranchMetadata();
			assert.strictEqual(metadataFactoryCount, 2);
		});

		function createBranch(path: string, metadata: BranchMetadata | undefined): GitBranch {
			return new GitBranch(path, 'refs/heads/main', true, undefined, metadata, 'abc123');
		}

		/** Caches `branches` as the branch list, mapped to each path as is */
		function readBranches(branches: () => GitBranch[]): Promise<PagedResult<GitBranch>> {
			return cache.getBranches(
				repoPath,
				() => ({ values: branches() }),
				result => result,
			);
		}

		/** Re-reads the map after a typed `'branches'` reset, which evicts it but no worktree's list */
		async function rereadBranchMetadataAfterReset(stale: BranchMetadata): Promise<BranchMetadata> {
			cache.clearCaches(repoPath, 'branches');
			const metadata = (await readBranchMetadata()).get('main');
			assert.ok(metadata);
			assert.notStrictEqual(metadata, stale);
			return metadata;
		}

		const stamp: BranchMetadataChange = {
			branch: 'main',
			key: 'gk-last-accessed',
			value: '2026-10-05T00:00:00.000Z',
		};

		test("a sibling worktree's current branch built from an earlier map is patched too", async () => {
			const worktree = '/test/repo-wt';
			cache.registerRepoPath(fileUri(repoPath), { uri: fileUri(`${repoPath}/.git`) });
			cache.registerRepoPath(fileUri(worktree), {
				uri: fileUri(`${repoPath}/.git/worktrees/wt`),
				commonUri: fileUri(`${repoPath}/.git`),
			});

			const stale = await seedBranchMetadata();
			const current = await cache.branch.getOrCreate(worktree, () =>
				Promise.resolve(createBranch(worktree, stale)),
			);
			const metadata = await rereadBranchMetadataAfterReset(stale);

			cache.patchBranchMetadata(repoPath, [stamp]);

			assert.strictEqual(deleteBranchMetadata.callCount, 0);
			assert.strictEqual(metadata.lastAccessedAt, stamp.value);
			assert.strictEqual(current?.metadata?.lastAccessedAt, stamp.value, "the sibling's current branch");
			assert.strictEqual(await cache.branch.get(worktree), current, 'still cached');
		});

		test("a cached worktree list's branch is patched, and an eviction drops the list", async () => {
			const stale = await seedBranchMetadata();
			let worktreesFactoryCount = 0;
			const readWorktrees = () =>
				cache.getWorktrees(repoPath, commonPath => {
					worktreesFactoryCount++;
					return [
						new GitWorktree(
							true,
							'branch',
							commonPath,
							fileUri(commonPath),
							false,
							false,
							'abc123',
							createBranch(commonPath, stale),
						),
					];
				});
			const [worktree] = await readWorktrees();
			const metadata = await rereadBranchMetadataAfterReset(stale);

			cache.patchBranchMetadata(repoPath, [stamp]);

			assert.strictEqual(deleteBranchMetadata.callCount, 0);
			assert.strictEqual(metadata.lastAccessedAt, stamp.value);
			assert.strictEqual(worktree.branch?.metadata?.lastAccessedAt, stamp.value);

			cache.deleteBranchMetadata(repoPath);
			await readWorktrees();
			assert.strictEqual(worktreesFactoryCount, 2, 'the worktrees hold the branches');
		});

		test('with no map cached, a cached branch list is still patched', async () => {
			const metadata: BranchMetadata = { lastAccessedAt: '2026-10-01T00:00:00.000Z' };
			let branchesFactoryCount = 0;
			const read = () =>
				readBranches(() => {
					branchesFactoryCount++;
					return [createBranch(repoPath, metadata)];
				});
			await read();

			cache.patchBranchMetadata(repoPath, [stamp]);

			assert.strictEqual(deleteBranchMetadata.callCount, 0);
			assert.strictEqual(metadata.lastAccessedAt, stamp.value);
			await read();
			assert.strictEqual(branchesFactoryCount, 1, 'served from the cache');
		});

		test('a cached branch of a changed name with no metadata to patch evicts once', async () => {
			let branchesFactoryCount = 0;
			const read = () =>
				readBranches(() => {
					branchesFactoryCount++;
					return [createBranch(repoPath, undefined)];
				});
			await read();

			cache.patchBranchMetadata(repoPath, [stamp, { ...stamp, key: 'gk-last-modified' }]);

			assert.strictEqual(deleteBranchMetadata.callCount, 1);
			await read();
			assert.strictEqual(branchesFactoryCount, 2);
		});

		test('a current branch still being read evicts', async () => {
			let release!: (branch: GitBranch) => void;
			const inFlight = cache.branch.getOrCreate(
				repoPath,
				() => new Promise<GitBranch>(resolve => (release = resolve)),
			);

			cache.patchBranchMetadata(repoPath, [stamp]);

			assert.strictEqual(deleteBranchMetadata.callCount, 1, 'the read may predate the write');
			assert.strictEqual(cache.branch.has(repoPath), false);
			release(createBranch(repoPath, { lastAccessedAt: '2026-10-01T00:00:00.000Z' }));
			await inFlight;
		});

		test("another process's stamps are patched in one call, without a merge-targets event", async () => {
			const metadata = await seedBranchMetadata();

			const result = registerTestReconciler(
				() =>
					new Map([
						['branch.main.gk-merge-target', 'origin/main'],
						['branch.main.gk-last-accessed', '2026-10-05T00:00:00.000Z'],
						['branch.main.gk-agent-last-activity', '2026-10-05T00:00:00.000Z'],
					]),
			);
			cache.onRepositoryChanged(repoPath, ['gkConfig']);
			assert.strictEqual(await result(), true, 'a follow-up event lets consumers re-read the branches');

			assert.strictEqual(patchBranchMetadata.callCount, 1, 'two changed stamps patch once');
			assert.strictEqual(deleteBranchMetadata.callCount, 0);
			assert.deepStrictEqual(events, [], 'activity stamps are not merge targets');
			assert.deepStrictEqual(metadata, {
				lastAccessedAt: '2026-10-05T00:00:00.000Z',
				agentLastActivityAt: '2026-10-05T00:00:00.000Z',
			});
			assert.strictEqual((await readBranchMetadata()).get('main'), metadata);
			assert.strictEqual(metadataFactoryCount, 1);
		});

		test("another process's first stamp on a branch evicts the branches once", async () => {
			await seedBranchMetadata();

			const result = registerTestReconciler(
				() =>
					new Map([
						...initial,
						['branch.feature.gk-last-accessed', '2026-10-05T00:00:00.000Z'],
						['branch.feature.gk-agent-last-activity', '2026-10-05T00:00:00.000Z'],
					]),
			);
			cache.onRepositoryChanged(repoPath, ['gkConfig']);
			assert.strictEqual(await result(), true);

			assert.strictEqual(deleteBranchMetadata.callCount, 1, 'two changed stamps still evict only once');
			assert.deepStrictEqual(events, []);
			await readBranchMetadata();
			assert.strictEqual(metadataFactoryCount, 2, 'the branches re-read the new stamps');
		});

		test("another process's removed stamp is removed from the cached metadata", async () => {
			const metadata = await seedBranchMetadata();

			const result = registerTestReconciler(() => new Map([['branch.main.gk-merge-target', 'origin/main']]));
			cache.onRepositoryChanged(repoPath, ['gkConfig']);
			assert.strictEqual(await result(), true);

			assert.ok(!('lastAccessedAt' in metadata));
			assert.strictEqual(deleteBranchMetadata.callCount, 0);
		});

		test("another process's disposition change is patched", async () => {
			const metadata = await seedBranchMetadata();

			const result = registerTestReconciler(
				() => new Map([...initial, ['branch.main.gk-disposition', 'starred']]),
			);
			cache.onRepositoryChanged(repoPath, ['gkConfig']);
			assert.strictEqual(await result(), true);

			assert.strictEqual(metadata.disposition, 'starred');
			assert.strictEqual(deleteBranchMetadata.callCount, 0);
			assert.deepStrictEqual(events, []);
		});

		test('a merge-key-only change leaves the branches cached', async () => {
			await seedBranchMetadata();

			const result = registerTestReconciler(
				() =>
					new Map([
						['branch.main.gk-merge-target', 'origin/develop'],
						['branch.main.gk-last-accessed', '2026-10-01T00:00:00.000Z'],
					]),
			);
			cache.onRepositoryChanged(repoPath, ['gkConfig']);
			assert.strictEqual(await result(), true);

			assert.strictEqual(patchBranchMetadata.callCount, 0);
			assert.strictEqual(deleteBranchMetadata.callCount, 0);
			assert.strictEqual(events.length, 1);
			await readBranchMetadata();
			assert.strictEqual(metadataFactoryCount, 1, 'branch metadata does not depend on merge keys');
		});

		test("core's own recorded stamp is not patched again by the watcher's report of it", async () => {
			const metadata = await seedBranchMetadata();

			// What `recordBranchActivity` does: write (recorded by `setGkConfig`), then patch the branches itself
			cache.recordGkConfigWrite(repoPath, 'branch.main.gk-last-accessed', '2026-10-05T00:00:00.000Z');
			assert.deepStrictEqual(events, [], 'recording an activity stamp never fires the merge-targets event');
			cache.patchBranchMetadata(repoPath, [
				{ branch: 'main', key: 'gk-last-accessed', value: '2026-10-05T00:00:00.000Z' },
			]);

			const result = registerTestReconciler(
				() =>
					new Map([
						['branch.main.gk-merge-target', 'origin/main'],
						['branch.main.gk-last-accessed', '2026-10-05T00:00:00.000Z'],
					]),
			);
			cache.onRepositoryChanged(repoPath, ['gkConfig']);
			assert.strictEqual(await result(), false, 'the write is already reflected in the snapshot');

			assert.strictEqual(patchBranchMetadata.callCount, 1, "only core's own patch");
			assert.strictEqual(deleteBranchMetadata.callCount, 0);
			assert.strictEqual(metadata.lastAccessedAt, '2026-10-05T00:00:00.000Z');
			await readBranchMetadata();
			assert.strictEqual(metadataFactoryCount, 1);
		});

		test("core's own section rename is not evicted again by the watcher's report of it", async () => {
			await seedBranchMetadata();

			cache.recordGkConfigSectionWrite(repoPath, 'main', 'renamed');
			const result = registerTestReconciler(
				() =>
					new Map([
						['branch.renamed.gk-merge-target', 'origin/main'],
						['branch.renamed.gk-last-accessed', '2026-10-01T00:00:00.000Z'],
					]),
			);
			cache.onRepositoryChanged(repoPath, ['gkConfig']);
			assert.strictEqual(await result(), false);

			assert.strictEqual(patchBranchMetadata.callCount, 0);
			assert.strictEqual(deleteBranchMetadata.callCount, 0);
		});

		test('the coarse fallback evicts the branches (no reconciler)', async () => {
			await seedBranchMetadata();

			cache.onRepositoryChanged(repoPath, ['gkConfig']);

			assert.strictEqual(deleteBranchMetadata.callCount, 1);
			await readBranchMetadata();
			assert.strictEqual(metadataFactoryCount, 2);
		});

		test('the coarse fallback evicts the branches (a failed reconcile)', async () => {
			await seedBranchMetadata();

			let outcome: Promise<'failed'> = Promise.resolve('failed');
			cache.setGkConfigReconciler(() => (outcome = Promise.resolve('failed')));
			cache.onRepositoryChanged(repoPath, ['gkConfig']);
			await outcome;
			await Promise.resolve();

			assert.strictEqual(deleteBranchMetadata.callCount, 1);
		});
	});
});

suite('Cache.onDidChangeMergeTargets', () => {
	const repoPath = '/test/repo';
	let cache: Cache;
	let events: MergeTargetsChangeEvent[];

	setup(() => {
		cache = new Cache();
		events = [];
		cache.onDidChangeMergeTargets(e => events.push(e));
	});

	teardown(() => {
		cache.dispose();
	});

	/** Seeds the reconcile baseline, then registers a reconciler that re-reads `next` (see the suite above) */
	async function seedThenReconcileTo(
		initial: [string, string][],
		next: [string, string][],
	): Promise<() => Promise<void>> {
		await cache.getGkConfigMap(repoPath, () => Promise.resolve(new Map(initial)));
		let pending: Promise<unknown> = Promise.resolve();
		cache.setGkConfigReconciler((rp, priorSnapshot) => {
			// The file changed since the map was read, so the reconciler evicts it
			cache.deleteGkConfigMap(rp);
			pending = cache
				.getGkConfigMap(rp, () => new Map(next))
				.then(freshMap => cache.reconcileGkConfigMap(rp, priorSnapshot, freshMap));
			return pending.then(() => 'reconciled' as const);
		});
		return async () => {
			await pending;
		};
	}

	test('stays silent for a rewrite that only touches activity timestamps', async () => {
		const settled = await seedThenReconcileTo(
			[
				['branch.main.gk-merge-target', 'origin/main'],
				['branch.main.gk-last-accessed', '2026-10-01T00:00:00.000Z'],
			],
			[
				['branch.main.gk-merge-target', 'origin/main'],
				['branch.main.gk-last-accessed', '2026-10-05T00:00:00.000Z'],
			],
		);
		cache.onRepositoryChanged(repoPath, ['gkConfig']);
		await settled();

		assert.deepStrictEqual(events, []);
	});

	test('names the branches whose merge keys changed', async () => {
		const settled = await seedThenReconcileTo(
			[
				['branch.main.gk-merge-target', 'origin/main'],
				['branch.feature.gk-merge-base', 'main'],
				['branch.other.gk-merge-base', 'main'],
			],
			[
				['branch.main.gk-merge-target', 'origin/main'],
				['branch.feature.gk-merge-base', 'develop'],
				['branch.other.gk-merge-base', 'main'],
				['branch.fresh.gk-merge-target-user', 'origin/release'],
			],
		);
		cache.onRepositoryChanged(repoPath, ['gkConfig']);
		await settled();

		assert.strictEqual(events.length, 1);
		assert.strictEqual(events[0].repoPath, repoPath);
		assert.deepStrictEqual([...(events[0].refs ?? [])].sort(), ['feature', 'fresh']);
	});

	test("fires once, naming the branch, for core's own key write, and not again for the watcher's report", async () => {
		const settled = await seedThenReconcileTo(
			[['branch.main.gk-merge-target', 'origin/main']],
			[['branch.main.gk-merge-target', 'origin/develop']],
		);
		// What `setGkConfig` records right after writing, before the watcher reports the file change
		cache.recordGkConfigWrite(repoPath, 'branch.main.gk-merge-target', 'origin/develop');
		assert.strictEqual(events.length, 1);
		assert.deepStrictEqual([...(events[0].refs ?? [])], ['main']);

		cache.onRepositoryChanged(repoPath, ['gkConfig']);
		await settled();

		assert.strictEqual(events.length, 1);
	});

	suite("a reconcile overlapping core's own key write", () => {
		const written: [string, string] = ['branch.main.gk-merge-target', 'origin/develop'];
		let file: Map<string, string>;
		let release: () => void;
		let gate: Promise<void>;

		/** Registers a reconciler whose re-read waits for `gate`, reading the file through `read` */
		function registerGatedReconciler(read: () => Promise<Map<string, string>>): () => Promise<void> {
			let pending: Promise<unknown> = Promise.resolve();
			cache.setGkConfigReconciler((rp, priorSnapshot) => {
				// The file changed since the map was read, so the reconciler evicts it
				cache.deleteGkConfigMap(rp);
				pending = cache
					.getGkConfigMap(rp, read)
					.then(freshMap => cache.reconcileGkConfigMap(rp, priorSnapshot, freshMap));
				return pending.then(() => 'reconciled' as const);
			});
			return async () => {
				await pending;
			};
		}

		/** Core writes and records a merge key while the reconcile is reading */
		function writeOwnKey(): void {
			file = new Map([...file, written]);
			cache.recordGkConfigWrite(repoPath, ...written);
			assert.strictEqual(events.length, 1);
			assert.deepStrictEqual([...(events[0].refs ?? [])], ['main']);
		}

		setup(async () => {
			file = new Map([
				['branch.main.gk-merge-target', 'origin/main'],
				['branch.feature.gk-merge-base', 'main'],
			]);
			await cache.getGkConfigMap(repoPath, () => Promise.resolve(new Map(file)));
			gate = new Promise<void>(resolve => (release = resolve));
		});

		test('a read that predates the write fires nothing for it, nor does the watcher report of it', async () => {
			const settled = registerGatedReconciler(() => {
				const content = file;
				return gate.then(() => new Map(content));
			});
			// Another process's change starts a reconcile whose read sees the file as it was before core's write
			cache.onRepositoryChanged(repoPath, ['gkConfig']);
			writeOwnKey();
			release();
			await settled();
			assert.strictEqual(events.length, 1);
			assert.strictEqual(cache.getGkConfigSnapshot(repoPath)?.get(written[0]), written[1], 'the write is kept');

			cache.onRepositoryChanged(repoPath, ['gkConfig']);
			await settled();
			assert.strictEqual(events.length, 1);
		});

		test('a read that follows the write fires nothing for it', async () => {
			const settled = registerGatedReconciler(() => gate.then(() => new Map(file)));
			cache.onRepositoryChanged(repoPath, ['gkConfig']);
			writeOwnKey();
			release();
			await settled();

			assert.strictEqual(events.length, 1);
		});

		test("still reports another process's change to a different merge key", async () => {
			const settled = registerGatedReconciler(() => gate.then(() => new Map(file)));
			cache.onRepositoryChanged(repoPath, ['gkConfig']);
			file = new Map([...file, ['branch.feature.gk-merge-base', 'develop']]);
			writeOwnKey();
			release();
			await settled();

			assert.strictEqual(events.length, 2);
			assert.deepStrictEqual([...(events[1].refs ?? [])], ['feature']);
		});
	});

	test("records core's internal self-write in the snapshot without firing", async () => {
		const settled = await seedThenReconcileTo(
			[['branch.main.gk-merge-target', 'origin/main']],
			[['branch.main.gk-merge-target', 'origin/develop']],
		);
		cache.recordGkConfigWrite(repoPath, 'branch.main.gk-merge-target', 'origin/develop', { announce: false });
		assert.deepStrictEqual(events, []);

		cache.onRepositoryChanged(repoPath, ['gkConfig']);
		await settled();

		assert.deepStrictEqual(events, [], "the watcher's reconcile of the recorded value fires nothing");
	});

	test("stays silent for core's own write of an unchanged value", async () => {
		const settled = await seedThenReconcileTo(
			[['branch.main.gk-merge-target', 'origin/main']],
			[['branch.main.gk-merge-target', 'origin/main']],
		);
		cache.recordGkConfigWrite(repoPath, 'branch.main.gk-merge-target', 'origin/main');
		cache.onRepositoryChanged(repoPath, ['gkConfig']);
		await settled();

		assert.deepStrictEqual(events, []);
	});

	test("stays silent for core's own section remove and rename (a branch delete or rename)", async () => {
		const settled = await seedThenReconcileTo(
			[
				['branch.gone.gk-merge-base', 'main'],
				['branch.old.gk-merge-target', 'origin/main'],
				['branch.old.gk-last-accessed', '2026-10-01T00:00:00.000Z'],
			],
			[
				['branch.new.gk-merge-target', 'origin/main'],
				['branch.new.gk-last-accessed', '2026-10-01T00:00:00.000Z'],
			],
		);
		cache.recordGkConfigSectionWrite(repoPath, 'gone');
		cache.recordGkConfigSectionWrite(repoPath, 'new');
		cache.recordGkConfigSectionWrite(repoPath, 'old', 'new');
		cache.onRepositoryChanged(repoPath, ['gkConfig']);
		await settled();

		assert.deepStrictEqual(events, []);
	});

	test('leaves a dotted sibling branch alone when recording a section remove or rename', async () => {
		// `--remove-section branch.feature` and `--rename-section branch.old` leave `[branch "feature.x"]` and
		// `[branch "old.y"]` in place, so the recorded snapshot must too
		const settled = await seedThenReconcileTo(
			[
				['branch.feature.gk-merge-base', 'main'],
				['branch.feature.x.gk-merge-base', 'main'],
				['branch.old.gk-merge-target', 'origin/main'],
				['branch.old.y.gk-merge-target', 'origin/develop'],
			],
			[
				['branch.feature.x.gk-merge-base', 'main'],
				['branch.new.gk-merge-target', 'origin/main'],
				['branch.old.y.gk-merge-target', 'origin/develop'],
			],
		);
		cache.recordGkConfigSectionWrite(repoPath, 'feature');
		cache.recordGkConfigSectionWrite(repoPath, 'new');
		cache.recordGkConfigSectionWrite(repoPath, 'old', 'new');
		cache.onRepositoryChanged(repoPath, ['gkConfig']);
		await settled();

		assert.deepStrictEqual(events, []);
	});

	test('reports every branch as possibly changed when there is no reconciler (the coarse fallback)', () => {
		cache.onRepositoryChanged(repoPath, ['gkConfig']);

		assert.deepStrictEqual(events, [{ repoPath: repoPath, refs: undefined }]);
	});

	test('reports every branch as possibly changed when the reconcile fails', async () => {
		let outcome: Promise<'failed'> = Promise.resolve('failed');
		cache.setGkConfigReconciler(() => (outcome = Promise.resolve('failed')));
		cache.onRepositoryChanged(repoPath, ['gkConfig']);
		await outcome;
		await Promise.resolve();

		assert.deepStrictEqual(events, [{ repoPath: repoPath, refs: undefined }]);
	});

	test('reports every branch as possibly changed with no earlier snapshot to diff against', async () => {
		let pending: Promise<unknown> = Promise.resolve();
		cache.setGkConfigReconciler((rp, priorSnapshot) => {
			cache.deleteGkConfigMap(rp);
			pending = cache
				.getGkConfigMap(rp, () => new Map([['branch.main.gk-merge-target', 'origin/main']]))
				.then(freshMap => cache.reconcileGkConfigMap(rp, priorSnapshot, freshMap));
			return pending.then(() => 'reconciled' as const);
		});
		cache.onRepositoryChanged(repoPath, ['gkConfig']);
		await pending;

		assert.deepStrictEqual(events, [{ repoPath: repoPath, refs: undefined }]);
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

suite('Cache.applyRepositoryChanges', () => {
	const repoPath = '/test/repo';
	let cache: Cache;

	setup(() => {
		cache = new Cache();
		cache.registerRepoPath(fileUri(repoPath), { uri: fileUri(`${repoPath}/.git`) });
	});

	teardown(() => {
		cache.dispose();
	});

	test("an 'index' change clears only what the index feeds, and advances the status clock", () => {
		cache.blame.set(repoPath, 'file.ts', Promise.resolve(undefined));
		cache.branches.set(repoPath, Promise.resolve({ values: [] } satisfies PagedResult<GitBranch>));
		cache.tags.set(repoPath, Promise.resolve({ values: [] } satisfies PagedResult<GitTag>));
		cache.worktrees.set(repoPath, Promise.resolve([]));
		cache.stashes.set(repoPath, 'all', Promise.resolve({ repoPath: repoPath, stashes: new Map() }));

		const types = cache.applyRepositoryChanges(repoPath, ['index'], 'evict');

		assert.deepStrictEqual([...types].sort(), ['blame', 'diff', 'fileLog', 'tracking']);
		assert.strictEqual(cache.getStatusGeneration(repoPath), 1);
		assert.strictEqual(cache.blame.get(repoPath, 'file.ts'), undefined, 'blame is fed by the index');
		assert.ok(cache.branches.has(repoPath), 'an index change cannot move a branch');
		assert.ok(cache.tags.has(repoPath), 'an index change cannot move a tag');
		assert.ok(cache.worktrees.has(repoPath), 'an index change cannot add or remove a worktree');
		assert.notStrictEqual(cache.stashes.get(repoPath, 'all'), undefined, 'an index change cannot stash');
	});

	test('a change that maps to no cache type clears nothing', () => {
		cache.worktrees.set(repoPath, Promise.resolve([]));

		const types = cache.applyRepositoryChanges(repoPath, ['starred'], 'evict');

		assert.deepStrictEqual(types, []);
		assert.ok(cache.worktrees.has(repoPath));
		assert.strictEqual(cache.getStatusGeneration(repoPath), 0);
	});

	test("'evict' never lets a later caller join a read that started before it; 'share' does", async () => {
		async function factoryCallsAcross(inFlight: 'share' | 'evict'): Promise<number> {
			let calls = 0;
			let release!: (worktrees: GitWorktree[]) => void;
			const gate = new Promise<GitWorktree[]>(resolve => (release = resolve));
			const factory = (): Promise<GitWorktree[]> => {
				calls++;
				return gate;
			};

			const before = cache.worktrees.getOrCreate(repoPath, factory);
			cache.applyRepositoryChanges(repoPath, ['worktrees'], inFlight);
			const after = cache.worktrees.getOrCreate(repoPath, factory);
			release([]);
			await Promise.all([before, after]);
			cache.worktrees.delete(repoPath);
			return calls;
		}

		assert.strictEqual(await factoryCallsAcross('share'), 1, 'a watcher clear keeps sharing the in-flight read');
		assert.strictEqual(await factoryCallsAcross('evict'), 2, 'an announced write must start a fresh read');
	});

	test('the watcher path applies the same mapping, sharing in-flight reads', () => {
		cache.blame.set(repoPath, 'file.ts', Promise.resolve(undefined));
		cache.branches.set(repoPath, Promise.resolve({ values: [] } satisfies PagedResult<GitBranch>));

		cache.onRepositoryChanged(repoPath, ['index']);

		assert.strictEqual(cache.getStatusGeneration(repoPath), 1);
		assert.strictEqual(cache.blame.get(repoPath, 'file.ts'), undefined);
		assert.ok(cache.branches.has(repoPath));
	});
});

suite('Cache.getWorktrees — force', () => {
	const repoPath = '/test/repo';
	const siblingPath = '/test/repo-wt';
	let cache: Cache;

	setup(() => {
		cache = new Cache();
		cache.registerRepoPath(fileUri(repoPath), { uri: fileUri(`${repoPath}/.git`) });
		cache.registerRepoPath(fileUri(siblingPath), {
			uri: fileUri(`${repoPath}/.git/worktrees/wt`),
			commonUri: fileUri(`${repoPath}/.git`),
		});
	});

	teardown(() => {
		cache.dispose();
	});

	function worktreeList(commonPath: string, ...branchNames: string[]): GitWorktree[] {
		return branchNames.map(
			(name, i) =>
				new GitWorktree(
					i === 0,
					'branch',
					commonPath,
					fileUri(`${commonPath}/${name}`),
					false,
					false,
					'abc123',
					undefined,
					undefined,
					name,
				),
		);
	}

	test('re-reads only the worktree list and keeps every other cache', async () => {
		let factoryCount = 0;
		const read = (path: string, force?: boolean) =>
			cache.getWorktrees(
				path,
				commonPath => {
					factoryCount++;
					return worktreeList(commonPath, 'main', ...(factoryCount > 1 ? ['fresh'] : []));
				},
				force ? { force: true } : undefined,
			);

		assert.strictEqual((await read(repoPath)).length, 1);
		assert.strictEqual((await read(siblingPath)).length, 1);
		assert.strictEqual(factoryCount, 1, 'the sibling is served from the shared list');

		const branches = Promise.resolve({ values: [] } satisfies PagedResult<GitBranch>);
		cache.branches.set(repoPath, branches);
		const gitResult: GitResult = {
			stdout: 'x',
			stderr: undefined,
			exitCode: 0,
			completion: { status: 'exited', code: 0 },
		};
		await cache.gitResults.getOrCreate(siblingPath, 'git status', () => Promise.resolve(gitResult));

		const forced = await read(repoPath, true);
		assert.strictEqual(factoryCount, 2, 'the forced read re-ran the factory');
		assert.deepStrictEqual(
			forced.map(w => w.branchName),
			['main', 'fresh'],
		);

		const sibling = await read(siblingPath);
		assert.strictEqual(factoryCount, 2, "the sibling's dropped entry was re-derived from the new list");
		assert.deepStrictEqual(
			sibling.map(w => w.branchName),
			['main', 'fresh'],
		);
		assert.strictEqual(sibling[0].repoPath, siblingPath);

		assert.strictEqual(cache.branches.get(repoPath), branches, 'the branch list is kept');
		assert.ok(cache.gitResults.get(siblingPath, 'git status'), 'gitResults are kept');
	});

	test('does not join a read that started before it', async () => {
		let factoryCount = 0;
		let resolveFirst!: (value: GitWorktree[]) => void;

		const first = cache.getWorktrees(
			repoPath,
			() =>
				new Promise<GitWorktree[]>(resolve => {
					factoryCount++;
					resolveFirst = resolve;
				}),
		);

		const second = cache.getWorktrees(
			repoPath,
			commonPath => {
				factoryCount++;
				return worktreeList(commonPath, 'main', 'fresh');
			},
			{ force: true },
		);

		resolveFirst(worktreeList(repoPath, 'main'));

		const [firstResult, secondResult] = await Promise.all([first, second]);
		assert.strictEqual(factoryCount, 2, 'the forced read ran its own factory');
		assert.strictEqual(firstResult.length, 1);
		assert.strictEqual(secondResult.length, 2);

		const later = await cache.getWorktrees(repoPath, () => {
			factoryCount++;
			return [];
		});
		assert.strictEqual(factoryCount, 2, 'the older read settling must not displace the forced answer');
		assert.strictEqual(later.length, 2);
	});

	test('an aborted forced read rejects and keeps the cached list', async () => {
		let factoryCount = 0;
		const factory = (commonPath: string) => {
			factoryCount++;
			return worktreeList(commonPath, 'main');
		};
		const cached = await cache.getWorktrees(repoPath, factory);

		const controller = new AbortController();
		controller.abort();
		await assert.rejects(cache.getWorktrees(repoPath, factory, { force: true }, controller.signal), (ex: unknown) =>
			isCancellationError(ex),
		);

		assert.strictEqual(await cache.getWorktrees(repoPath, factory), cached);
		assert.strictEqual(factoryCount, 1);
	});
});

suite('Cache — worktree list vs worktree HEAD changes', () => {
	const repoPath = '/test/repo';
	const siblingPath = '/test/repo-wt';
	const gitResult: GitResult = {
		stdout: 'x',
		stderr: undefined,
		exitCode: 0,
		completion: { status: 'exited', code: 0 },
	};
	let cache: Cache;
	let reads: { worktrees: number; gitResults: number; mergeTargets: number };

	setup(() => {
		cache = new Cache();
		cache.registerRepoPath(fileUri(repoPath), { uri: fileUri(`${repoPath}/.git`) });
		cache.registerRepoPath(fileUri(siblingPath), {
			uri: fileUri(`${repoPath}/.git/worktrees/wt`),
			commonUri: fileUri(`${repoPath}/.git`),
		});
		reads = { worktrees: 0, gitResults: 0, mergeTargets: 0 };
	});

	teardown(() => {
		cache.dispose();
	});

	/** Reads the worktree list, a sibling's git result and a merge target a checkout would evict, counting the misses */
	async function readAll(): Promise<void> {
		await cache.getWorktrees(repoPath, () => {
			reads.worktrees++;
			return [];
		});
		await cache.gitResults.getOrCreate(siblingPath, 'git status', () => {
			reads.gitResults++;
			return Promise.resolve(gitResult);
		});
		await cache.getMergeTarget(repoPath, 'refs/heads/feature', () => {
			reads.mergeTargets++;
			return {
				result: undefined,
				selfAtTip: false,
				tips: [],
				replaced: '',
				shallow: null,
				configKey: undefined,
				stored: undefined,
				evictOnCheckout: true,
			};
		});
	}

	test('a worktrees change evicts only the worktree list', async () => {
		await readAll();
		const types = cache.applyRepositoryChanges(repoPath, ['worktrees'], 'share');
		await readAll();

		assert.deepStrictEqual(types, ['worktreeList']);
		assert.deepStrictEqual(reads, { worktrees: 2, gitResults: 1, mergeTargets: 1 });
	});

	test("a worktree's HEAD moving also evicts every worktree's git results and the checkout's merge targets", async () => {
		await readAll();
		const types = cache.applyRepositoryChanges(repoPath, ['worktrees', 'worktreeHead'], 'share');
		await readAll();

		assert.deepStrictEqual(types, ['worktrees']);
		assert.deepStrictEqual(reads, { worktrees: 2, gitResults: 2, mergeTargets: 2 });
	});

	test("clearing the 'worktrees' type still evicts all three, and 'worktreeList' only the list", async () => {
		await readAll();
		cache.clearCaches(repoPath, 'worktreeList');
		await readAll();
		assert.deepStrictEqual(reads, { worktrees: 2, gitResults: 1, mergeTargets: 1 });

		cache.clearCaches(repoPath, 'worktrees');
		await readAll();
		assert.deepStrictEqual(reads, { worktrees: 3, gitResults: 2, mergeTargets: 2 });
	});
});

suite('GitWorktree.withRepoPath', () => {
	test('preserves branchName', () => {
		const worktree = new GitWorktree(
			false,
			'branch',
			'/test/repo',
			fileUri('/test/repo-wt'),
			false,
			false,
			'abc123',
			undefined,
			undefined,
			'feature/x',
		);

		assert.strictEqual(worktree.withRepoPath('/test/other').branchName, 'feature/x');
	});
});

suite('GitWorktree.name', () => {
	test('falls back to branchName when no branch was matched', () => {
		const worktree = new GitWorktree(
			false,
			'branch',
			'/test/repo',
			fileUri('/test/repo-wt'),
			false,
			false,
			'abc123',
			undefined,
			undefined,
			'feature/x',
		);

		assert.strictEqual(worktree.name, 'feature/x');
	});
});

suite('resetDropsPendingRuns', () => {
	const cases: [string, readonly CachedGitTypes[] | undefined, boolean][] = [
		['undefined, a reset of everything', undefined, true],
		['an empty list, a reset of everything', [], true],
		['the worktree list alone', ['worktreeList'], false],
		['providers alone', ['providers'], false],
		['providers and the worktree list', ['providers', 'worktreeList'], false],
		['branches', ['branches'], true],
		['the worktree list and branches', ['worktreeList', 'branches'], true],
	];

	for (const [name, types, expected] of cases) {
		test(`${name} ${expected ? 'drops' : 'keeps'} in-flight runs`, () => {
			assert.strictEqual(resetDropsPendingRuns(types), expected);
		});
	}
});
