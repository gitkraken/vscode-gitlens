import * as assert from 'assert';
import { Cache } from '@gitlens/git/cache.js';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { GitDir } from '@gitlens/git/models/repository.js';
import { GitTag } from '@gitlens/git/models/tag.js';
import { CancellationError } from '@gitlens/utils/cancellation.js';
import type { PagedResult } from '@gitlens/utils/paging.js';
import type { CacheController } from '@gitlens/utils/promiseCache.js';
import type { Uri } from '@gitlens/utils/uri.js';

async function flush(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise: promise, resolve: resolve, reject: reject };
}

// Helper to create a mock GitDir
function createMockGitDir(commonUri: Uri | undefined): GitDir {
	const uri: unknown = { fsPath: '/mock/.git', path: '/mock/.git', scheme: 'file' };
	return {
		uri: uri as Uri,
		commonUri: commonUri,
	};
}

// Helper to create a mock Uri
function createMockUri(path: string): Uri {
	const uri = {
		fsPath: path,
		path: path,
		scheme: 'file',
		with: (change: { path?: string; scheme?: string }) => {
			return createMockUri(change.path ?? path);
		},
	};
	return uri as Uri;
}

suite('Cache Test Suite', () => {
	suite('CommonPath Registry', () => {
		test('registers main repo with commonPath equal to repoPath', () => {
			const cache = new Cache();
			const repoUri = createMockUri('/code/project');
			const gitDir = createMockGitDir(undefined); // No commonUri means main repo

			cache.registerRepoPath(repoUri, gitDir);

			assert.strictEqual(cache.getCommonPath('/code/project'), '/code/project');
			assert.strictEqual(cache.isWorktree('/code/project'), false);
		});

		test('registers worktree with different commonPath', () => {
			const cache = new Cache();
			const worktreeUri = createMockUri('/code/project-feature');
			const gitDir = createMockGitDir(createMockUri('/code/project/.git'));

			cache.registerRepoPath(worktreeUri, gitDir);

			assert.strictEqual(cache.getCommonPath('/code/project-feature'), '/code/project');
			assert.strictEqual(cache.isWorktree('/code/project-feature'), true);
		});

		test('getCommonPath returns input path for unregistered paths', () => {
			const cache = new Cache();

			assert.strictEqual(cache.getCommonPath('/unknown/path'), '/unknown/path');
		});

		test('getWorktreePaths returns all paths sharing a commonPath', () => {
			const cache = new Cache();

			// Register main repo
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));

			// Register worktrees
			cache.registerRepoPath(
				createMockUri('/code/project-feature-a'),
				createMockGitDir(createMockUri('/code/project/.git')),
			);
			cache.registerRepoPath(
				createMockUri('/code/project-feature-b'),
				createMockGitDir(createMockUri('/code/project/.git')),
			);

			const worktreePaths = cache.getWorktreePaths('/code/project');

			assert.strictEqual(worktreePaths.length, 3);
			assert.ok(worktreePaths.includes('/code/project'));
			assert.ok(worktreePaths.includes('/code/project-feature-a'));
			assert.ok(worktreePaths.includes('/code/project-feature-b'));
		});

		test('isWorktree returns false for main repo even when registered with worktrees', () => {
			const cache = new Cache();

			// Register main repo
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));

			// Register a worktree
			cache.registerRepoPath(
				createMockUri('/code/project-feature'),
				createMockGitDir(createMockUri('/code/project/.git')),
			);

			assert.strictEqual(cache.isWorktree('/code/project'), false);
			assert.strictEqual(cache.isWorktree('/code/project-feature'), true);
		});
	});

	suite('unregisterRepoPath', () => {
		test('removes a worktree from the registry and clears its per-worktree caches', async () => {
			const cache = new Cache();
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));
			cache.registerRepoPath(
				createMockUri('/code/project-feature'),
				createMockGitDir(createMockUri('/code/project/.git')),
			);

			// Populate a per-worktree branches entry for the worktree we're about to unregister
			await cache.getBranches(
				'/code/project-feature',
				() => ({ values: [] }),
				branches => branches,
			);

			assert.strictEqual(cache.isWorktree('/code/project-feature'), true);
			assert.ok(cache.getWorktreePaths('/code/project').includes('/code/project-feature'));

			cache.unregisterRepoPath('/code/project-feature');

			// Registry cleanup
			assert.strictEqual(
				cache.getCommonPath('/code/project-feature'),
				'/code/project-feature',
				'unregistered path should fall through to returning itself as commonPath',
			);
			assert.strictEqual(cache.isWorktree('/code/project-feature'), false);
			assert.ok(!cache.getWorktreePaths('/code/project').includes('/code/project-feature'));

			// Main repo unaffected
			assert.strictEqual(cache.isWorktree('/code/project'), false);
			assert.ok(cache.getWorktreePaths('/code/project').includes('/code/project'));
		});

		test('does not cascade to sibling worktrees sharing the commonPath', () => {
			const cache = new Cache();
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));
			cache.registerRepoPath(
				createMockUri('/code/project-feature-a'),
				createMockGitDir(createMockUri('/code/project/.git')),
			);
			cache.registerRepoPath(
				createMockUri('/code/project-feature-b'),
				createMockGitDir(createMockUri('/code/project/.git')),
			);

			cache.unregisterRepoPath('/code/project-feature-a');

			// Siblings untouched
			assert.strictEqual(cache.isWorktree('/code/project-feature-b'), true);
			assert.strictEqual(cache.getCommonPath('/code/project-feature-b'), '/code/project');
			assert.ok(cache.getWorktreePaths('/code/project').includes('/code/project-feature-b'));
			assert.ok(!cache.getWorktreePaths('/code/project').includes('/code/project-feature-a'));
		});

		test('unregistering the main repo empties the worktree set when no worktrees remain', () => {
			const cache = new Cache();
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));

			cache.unregisterRepoPath('/code/project');

			assert.strictEqual(cache.getWorktreePaths('/code/project').length, 0);
			assert.strictEqual(cache.isWorktree('/code/project'), false);
		});

		test('unregistering the main repo leaves sibling worktrees registered', () => {
			const cache = new Cache();
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));
			cache.registerRepoPath(
				createMockUri('/code/project-feature'),
				createMockGitDir(createMockUri('/code/project/.git')),
			);

			cache.unregisterRepoPath('/code/project');

			// The worktree still maps to the commonPath and remains in the set
			assert.strictEqual(cache.getCommonPath('/code/project-feature'), '/code/project');
			assert.ok(cache.getWorktreePaths('/code/project').includes('/code/project-feature'));
			assert.ok(!cache.getWorktreePaths('/code/project').includes('/code/project'));
		});

		test('in-flight factory still completes for existing waiters after unregister', async () => {
			const cache = new Cache();
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));
			cache.registerRepoPath(
				createMockUri('/code/project-feature'),
				createMockGitDir(createMockUri('/code/project/.git')),
			);

			const d = deferred<PagedResult<GitBranch>>();
			const p = cache.getBranches(
				'/code/project-feature',
				() => d.promise,
				branches => branches,
			);

			// Unregister while the factory is still pending
			cache.unregisterRepoPath('/code/project-feature');

			// Existing waiter still resolves with the in-flight value (soft-invalidate semantics)
			d.resolve({ values: [] });
			const result = await p;
			assert.deepStrictEqual(result.values, []);

			// Registry is clean
			assert.strictEqual(cache.isWorktree('/code/project-feature'), false);
		});

		test("onRepositoryChanged('closed') unregisters the repoPath", () => {
			const cache = new Cache();
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));

			cache.onRepositoryChanged('/code/project', ['closed']);

			assert.strictEqual(cache.getWorktreePaths('/code/project').length, 0);
			assert.strictEqual(cache.isWorktree('/code/project'), false);
		});

		test('unregistering an unknown path is a no-op', () => {
			const cache = new Cache();
			assert.doesNotThrow(() => cache.unregisterRepoPath('/code/never-registered'));
		});

		test('cancellation after unregister still aborts the in-flight factory', async () => {
			// Regression: unregisterRepoPath must soft-invalidate so in-flight abort wiring survives.
			// A hard-delete would dispose the aggregate, leaving a subsequent caller cancellation
			// unable to reach the factory, which would then keep running against a deleted path.
			const cache = new Cache();
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));
			cache.registerRepoPath(
				createMockUri('/code/project-feature'),
				createMockGitDir(createMockUri('/code/project/.git')),
			);

			const d = deferred<PagedResult<GitBranch>>();
			let factorySignal: AbortSignal | undefined;
			const factory = (
				_commonPath: string,
				_cacheable: CacheController,
				signal?: AbortSignal,
			): Promise<PagedResult<GitBranch>> => {
				factorySignal = signal;
				return d.promise;
			};
			const mapper = (b: PagedResult<GitBranch>): PagedResult<GitBranch> => b;

			const ctrl = new AbortController();
			const p = cache.getBranches('/code/project-feature', factory, mapper, ctrl.signal);

			assert.ok(factorySignal != null, 'factory must receive an aggregate signal');
			assert.strictEqual(factorySignal.aborted, false);

			// Unregister while factory is still pending — must NOT dispose the abort wiring.
			cache.unregisterRepoPath('/code/project-feature');

			// Sole caller now cancels — the factory's aggregate signal must still fire so the
			// underlying work can abort (otherwise it runs forever against a deleted path).
			ctrl.abort();
			await flush();

			assert.strictEqual(
				factorySignal.aborted,
				true,
				'sole caller cancellation must propagate to the factory aggregate even after unregister',
			);
			await assert.rejects(p, (e: unknown) => e instanceof CancellationError);

			// Resolve to unblock dangling reference cleanup
			d.resolve({ values: [] });
		});

		test('unregistering a worktree preserves shared caches used by sibling worktrees', async () => {
			// Regression: unregisterRepoPath must not nuke shared caches that sibling worktrees
			// still depend on. Only per-repoPath entries (and, on the last worktree, the shared
			// commonPath entry) should be evicted.
			const cache = new Cache();
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));
			cache.registerRepoPath(
				createMockUri('/code/project-feature-a'),
				createMockGitDir(createMockUri('/code/project/.git')),
			);
			cache.registerRepoPath(
				createMockUri('/code/project-feature-b'),
				createMockGitDir(createMockUri('/code/project/.git')),
			);

			let factoryCallCount = 0;
			const factory = (commonPath: string): PagedResult<GitTag> => {
				factoryCallCount++;
				return {
					values: [new GitTag(commonPath, 'refs/tags/v1.0', 'abc', 'Release', undefined, undefined)],
				};
			};

			// Populate shared cache from all paths — one factory call, three mappers.
			await cache.getTags('/code/project', factory);
			await cache.getTags('/code/project-feature-a', factory);
			await cache.getTags('/code/project-feature-b', factory);
			assert.strictEqual(factoryCallCount, 1);

			// Unregister one worktree. This must NOT invalidate the shared commonPath entry or
			// the sibling worktree's mapped entry — siblings still need to read from cache.
			cache.unregisterRepoPath('/code/project-feature-a');

			// Sibling worktree and main repo should still read from cache (no new factory calls).
			await cache.getTags('/code/project-feature-b', factory);
			await cache.getTags('/code/project', factory);
			assert.strictEqual(
				factoryCallCount,
				1,
				'unregistering one worktree must not force sibling or main repo to refetch shared data',
			);
		});

		test('unregistering the last worktree evicts the shared commonPath entry', async () => {
			const cache = new Cache();
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));

			let factoryCallCount = 0;
			const factory = (commonPath: string): PagedResult<GitTag> => {
				factoryCallCount++;
				return {
					values: [new GitTag(commonPath, 'refs/tags/v1.0', 'abc', 'Release', undefined, undefined)],
				};
			};

			await cache.getTags('/code/project', factory);
			assert.strictEqual(factoryCallCount, 1);

			// Main repo is the only registered path — unregistering it should evict the shared
			// entry so a subsequent (re-registered) caller rebuilds from scratch.
			cache.unregisterRepoPath('/code/project');

			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));
			await cache.getTags('/code/project', factory);
			assert.strictEqual(
				factoryCallCount,
				2,
				'after unregistering the last worktree the shared entry must be gone',
			);
		});
	});

	suite('Shared Cache Accessors', () => {
		test('getTags caches by commonPath for main repo', async () => {
			const cache = new Cache();
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));

			let factoryCallCount = 0;
			const factory = (commonPath: string): PagedResult<GitTag> => {
				factoryCallCount++;
				return {
					values: [new GitTag(commonPath, 'refs/tags/v1.0', 'abc123', 'Release', undefined, undefined)],
				};
			};

			// First call should invoke factory
			const result1 = await cache.getTags('/code/project', factory);
			assert.strictEqual(factoryCallCount, 1);
			assert.strictEqual(result1.values.length, 1);
			assert.strictEqual(result1.values[0].repoPath, '/code/project');

			// Second call should use cache
			const result2 = await cache.getTags('/code/project', factory);
			assert.strictEqual(factoryCallCount, 1); // No additional call
			assert.strictEqual(result2.values[0].id, result1.values[0].id);
		});

		test('getTags shares cache between worktrees with cloned tags', async () => {
			const cache = new Cache();

			// Register main repo and worktree
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));
			cache.registerRepoPath(
				createMockUri('/code/project-feature'),
				createMockGitDir(createMockUri('/code/project/.git')),
			);

			let factoryCallCount = 0;
			const factory = (commonPath: string): PagedResult<GitTag> => {
				factoryCallCount++;
				return {
					values: [new GitTag(commonPath, 'refs/tags/v1.0', 'abc123', 'Release', undefined, undefined)],
				};
			};

			// Fetch from worktree - should create shared cache at commonPath
			const result1 = await cache.getTags('/code/project-feature', factory);
			assert.strictEqual(factoryCallCount, 1);
			assert.strictEqual(result1.values[0].repoPath, '/code/project-feature');

			// Fetch from main repo - should use shared cache
			const result2 = await cache.getTags('/code/project', factory);
			assert.strictEqual(factoryCallCount, 1); // No additional call
			assert.strictEqual(result2.values[0].repoPath, '/code/project');

			// Tags have different repoPath but same underlying data
			assert.strictEqual(result1.values[0].name, result2.values[0].name);
			assert.strictEqual(result1.values[0].sha, result2.values[0].sha);
		});

		test('getTags converges concurrent callers with distinct signals onto a single factory', async () => {
			const cache = new Cache();
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));

			let factoryCallCount = 0;
			let factorySignal: AbortSignal | undefined;
			const d = deferred<PagedResult<GitTag>>();
			const factory = (
				commonPath: string,
				_cacheable: CacheController,
				signal?: AbortSignal,
			): Promise<PagedResult<GitTag>> => {
				factoryCallCount++;
				factorySignal = signal;
				return d.promise.then(r => ({
					values: r.values.map(t => new GitTag(commonPath, t.name, t.sha, t.message, t.date, t.commitDate)),
				}));
			};

			const ctrl1 = new AbortController();
			const ctrl2 = new AbortController();

			const p1 = cache.getTags('/code/project', factory, ctrl1.signal);
			const p2 = cache.getTags('/code/project', factory, ctrl2.signal);

			assert.strictEqual(factoryCallCount, 1, 'concurrent getTags callers must share one factory');

			ctrl1.abort();
			await flush();
			assert.strictEqual(factorySignal!.aborted, false, 'aggregate must not fire while p2 still waits');

			await assert.rejects(p1, (e: unknown) => e instanceof CancellationError);

			d.resolve({
				values: [new GitTag('/code/project', 'refs/tags/v1.0', 'abc123', 'Release', undefined, undefined)],
			});
			const result = await p2;
			assert.strictEqual(result.values.length, 1);
		});

		test('getTags fetches once when main repo queries first', async () => {
			const cache = new Cache();

			// Register main repo and worktree
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));
			cache.registerRepoPath(
				createMockUri('/code/project-feature'),
				createMockGitDir(createMockUri('/code/project/.git')),
			);

			let factoryCallCount = 0;
			const factory = (commonPath: string): PagedResult<GitTag> => {
				factoryCallCount++;
				return {
					values: [new GitTag(commonPath, 'refs/tags/v1.0', 'abc123', 'Release', undefined, undefined)],
				};
			};

			// Fetch from main repo first
			const result1 = await cache.getTags('/code/project', factory);
			assert.strictEqual(factoryCallCount, 1);
			assert.strictEqual(result1.values[0].repoPath, '/code/project');

			// Fetch from worktree - should clone from shared cache
			const result2 = await cache.getTags('/code/project-feature', factory);
			assert.strictEqual(factoryCallCount, 1); // No additional call
			assert.strictEqual(result2.values[0].repoPath, '/code/project-feature');
		});
	});

	suite('Cache Invalidation', () => {
		test('clearCaches during in-flight getTags soft-invalidates; waiter still resolves; next caller joins', async () => {
			const cache = new Cache();
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));

			let factoryCallCount = 0;
			const d = deferred<PagedResult<GitTag>>();
			const factory = (commonPath: string): Promise<PagedResult<GitTag>> => {
				factoryCallCount++;
				return d.promise.then(r => ({
					values: r.values.map(t => new GitTag(commonPath, t.name, t.sha, t.message, t.date, t.commitDate)),
				}));
			};

			const p1 = cache.getTags('/code/project', factory);

			// Soft-invalidate while factory is still pending
			cache.clearCaches('/code/project', 'tags');

			// New caller during in-flight must share the same pending promise, not trigger a new factory
			const p2 = cache.getTags('/code/project', factory);
			assert.strictEqual(
				factoryCallCount,
				1,
				'in-flight soft-invalidated entry must still dedup concurrent callers',
			);

			// Existing waiter still resolves with the in-flight value
			d.resolve({
				values: [new GitTag('/code/project', 'refs/tags/v1.0', 'abc', 'Release', undefined, undefined)],
			});
			await p1;
			await p2;

			// After settle, the entry is evicted: next caller spawns a fresh factory
			await flush();
			const d2 = deferred<PagedResult<GitTag>>();
			const p3 = cache.getTags('/code/project', (commonPath: string) => {
				factoryCallCount++;
				return d2.promise.then(r => ({
					values: r.values.map(t => new GitTag(commonPath, t.name, t.sha, t.message, t.date, t.commitDate)),
				}));
			});
			assert.strictEqual(factoryCallCount, 2);
			d2.resolve({
				values: [new GitTag('/code/project', 'refs/tags/v1.0', 'abc', 'Release', undefined, undefined)],
			});
			await p3;
		});

		test('clearCaches clears shared caches across all worktrees', async () => {
			const cache = new Cache();

			// Register main repo and worktrees
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));
			cache.registerRepoPath(
				createMockUri('/code/project-feature-a'),
				createMockGitDir(createMockUri('/code/project/.git')),
			);
			cache.registerRepoPath(
				createMockUri('/code/project-feature-b'),
				createMockGitDir(createMockUri('/code/project/.git')),
			);

			let factoryCallCount = 0;
			const factory = (commonPath: string): PagedResult<GitTag> => {
				factoryCallCount++;
				return {
					values: [new GitTag(commonPath, 'refs/tags/v1.0', 'abc123', 'Release', undefined, undefined)],
				};
			};

			// Populate cache from all paths
			await cache.getTags('/code/project', factory);
			await cache.getTags('/code/project-feature-a', factory);
			await cache.getTags('/code/project-feature-b', factory);
			assert.strictEqual(factoryCallCount, 1); // All shared same cache

			// Clear tags cache from one worktree
			cache.clearCaches('/code/project-feature-a', 'tags');

			// All paths should need to refetch
			await cache.getTags('/code/project', factory);
			assert.strictEqual(factoryCallCount, 2);

			await cache.getTags('/code/project-feature-a', factory);
			assert.strictEqual(factoryCallCount, 2); // Uses newly populated cache

			await cache.getTags('/code/project-feature-b', factory);
			assert.strictEqual(factoryCallCount, 2); // Uses newly populated cache
		});

		test('factory self-invalidate without rejection: subsequent worktree call does not serve stale mapper', async () => {
			// Regression: when the shared factory calls `cacheable.invalidate()` and resolves
			// (rather than rejecting), the commonPath entry self-evicts but the per-worktree
			// mapper entry (cached via `.set()`) must also be cleared. The most likely real-world
			// trigger is a provider's error-path fallback (e.g. remotes.ts returning [] after a
			// caught error), which previously left worktrees stuck with the stale fallback data.
			const cache = new Cache();
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));
			cache.registerRepoPath(
				createMockUri('/code/project-feature'),
				createMockGitDir(createMockUri('/code/project/.git')),
			);

			let factoryCallCount = 0;

			// First factory: simulate provider error-path — invalidate then resolve with empty fallback
			const factory1 = (_commonPath: string, cacheable: CacheController): Promise<PagedResult<GitTag>> => {
				factoryCallCount++;
				cacheable.invalidate();
				return Promise.resolve({ values: [] });
			};

			const result1 = await cache.getTags('/code/project-feature', factory1);
			assert.strictEqual(factoryCallCount, 1);
			assert.strictEqual(result1.values.length, 0);

			// Allow the factory's .finally handlers (cascade + commonPath eviction) to run
			await flush();

			// Next caller at the same worktree must spawn a fresh factory AND rebuild the mapper —
			// it must NOT serve the stale empty mapper cached by the first call.
			const factory2 = (commonPath: string): PagedResult<GitTag> => {
				factoryCallCount++;
				return {
					values: [new GitTag(commonPath, 'refs/tags/v1.0', 'abc', 'Release', undefined, undefined)],
				};
			};

			const result2 = await cache.getTags('/code/project-feature', factory2);
			assert.strictEqual(factoryCallCount, 2, 'second call must trigger a fresh factory');
			assert.strictEqual(
				result2.values.length,
				1,
				'second call must receive fresh data, not the stale empty mapper',
			);
			assert.strictEqual(result2.values[0].repoPath, '/code/project-feature');
		});

		test('factory self-invalidate without rejection: cascade also clears sibling-worktree mappers', async () => {
			// Companion to the above: when a factory self-invalidates, every known worktree's
			// derived mapper entry must be cleared, not just the caller's. Otherwise any sibling
			// worktree that had previously populated its mapper would still serve stale data.
			const cache = new Cache();
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));
			cache.registerRepoPath(
				createMockUri('/code/project-feature-a'),
				createMockGitDir(createMockUri('/code/project/.git')),
			);
			cache.registerRepoPath(
				createMockUri('/code/project-feature-b'),
				createMockGitDir(createMockUri('/code/project/.git')),
			);

			let factoryCallCount = 0;

			// Seed both worktree mappers off a clean factory
			const seedFactory = (commonPath: string): PagedResult<GitTag> => {
				factoryCallCount++;
				return {
					values: [new GitTag(commonPath, 'refs/tags/v0.1', 'aaa', 'Seed', undefined, undefined)],
				};
			};
			await cache.getTags('/code/project-feature-a', seedFactory);
			await cache.getTags('/code/project-feature-b', seedFactory);
			assert.strictEqual(factoryCallCount, 1, 'seed factory runs once (shared)');

			// Drop the shared commonPath entry but leave mappers cached (pretend a partial clear).
			// Use clearCaches to target only the commonPath entry would be ideal, but since our
			// actual regression is the factory-settle path, we instead invoke a new factory that
			// self-invalidates. We need a cache miss at commonPath first, so clear everything
			// and re-run.
			cache.clearCaches('/code/project-feature-a', 'tags');
			await flush();

			// A subsequent call triggers a new factory that self-invalidates.
			const invalidatingFactory = (
				_commonPath: string,
				cacheable: CacheController,
			): Promise<PagedResult<GitTag>> => {
				factoryCallCount++;
				cacheable.invalidate();
				return Promise.resolve({ values: [] });
			};
			await cache.getTags('/code/project-feature-a', invalidatingFactory);
			await flush();

			// Both sibling worktree mappers should be cleared now — next call on sibling B must
			// spawn a fresh factory (not return stale seed data).
			const freshFactory = (commonPath: string): PagedResult<GitTag> => {
				factoryCallCount++;
				return {
					values: [new GitTag(commonPath, 'refs/tags/v2.0', 'ccc', 'Fresh', undefined, undefined)],
				};
			};
			const resultB = await cache.getTags('/code/project-feature-b', freshFactory);
			assert.strictEqual(
				resultB.values[0].name,
				'v2.0',
				'sibling worktree must not serve stale mapper after a factory self-invalidation',
			);
		});
	});

	suite('Branch Caching', () => {
		test('getBranches caches directly for non-worktree repos', async () => {
			const cache = new Cache();
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));

			let factoryCallCount = 0;
			const factory = (): PagedResult<GitBranch> => {
				factoryCallCount++;
				return { values: [] };
			};
			const mapper = (
				branches: PagedResult<GitBranch>,
				_targetRepoPath: string,
				_commonPath: string,
			): PagedResult<GitBranch> => branches;

			// First call
			await cache.getBranches('/code/project', factory, mapper);
			assert.strictEqual(factoryCallCount, 1);

			// Second call should use cache
			await cache.getBranches('/code/project', factory, mapper);
			assert.strictEqual(factoryCallCount, 1);
		});

		test('getBranches shares cache and calls mapper for worktrees', async () => {
			const cache = new Cache();

			// Register main repo and worktree
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));
			cache.registerRepoPath(
				createMockUri('/code/project-feature'),
				createMockGitDir(createMockUri('/code/project/.git')),
			);

			let factoryCallCount = 0;
			let mapperCallCount = 0;

			// Use mock branch objects since we're testing caching behavior
			type MockBranch = { name: string; repoPath: string };
			const factory = (commonPath: string): PagedResult<GitBranch> => {
				factoryCallCount++;
				return { values: [{ name: 'main', repoPath: commonPath }] } as unknown as PagedResult<GitBranch>;
			};

			const mapper = (
				branches: PagedResult<GitBranch>,
				targetRepoPath: string,
				_commonPath: string,
			): PagedResult<GitBranch> => {
				mapperCallCount++;
				const mockBranches = branches.values as unknown as MockBranch[];
				return {
					values: mockBranches.map(b => ({ ...b, repoPath: targetRepoPath })),
				} as unknown as PagedResult<GitBranch>;
			};

			// Fetch from worktree
			const result1 = await cache.getBranches('/code/project-feature', factory, mapper);
			assert.strictEqual(factoryCallCount, 1);
			assert.strictEqual(mapperCallCount, 1);
			assert.strictEqual((result1.values[0] as unknown as MockBranch).repoPath, '/code/project-feature');

			// Second call from same worktree should use cache (no map)
			void (await cache.getBranches('/code/project-feature', factory, mapper));
			assert.strictEqual(factoryCallCount, 1);
			assert.strictEqual(mapperCallCount, 1); // No additional call

			// Fetch from main repo should use shared cache and map (to set current flag)
			const result3 = await cache.getBranches('/code/project', factory, mapper);
			assert.strictEqual(factoryCallCount, 1); // Still uses shared factory data
			assert.strictEqual(mapperCallCount, 2); // Mapper called for main repo
			assert.strictEqual((result3.values[0] as unknown as MockBranch).repoPath, '/code/project');

			// Second call from main repo should use mapped cache
			void (await cache.getBranches('/code/project', factory, mapper));
			assert.strictEqual(factoryCallCount, 1);
			assert.strictEqual(mapperCallCount, 2); // No additional call
		});

		test('getBranches dedupes concurrent callers with distinct AbortSignals to a single factory invocation', async () => {
			const cache = new Cache();
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));

			let factoryCallCount = 0;
			const d = deferred<PagedResult<GitBranch>>();
			const factory = (): Promise<PagedResult<GitBranch>> => {
				factoryCallCount++;
				return d.promise;
			};
			const mapper = (b: PagedResult<GitBranch>): PagedResult<GitBranch> => b;

			const ctrl1 = new AbortController();
			const ctrl2 = new AbortController();

			const p1 = cache.getBranches('/code/project', factory, mapper, ctrl1.signal);
			const p2 = cache.getBranches('/code/project', factory, mapper, ctrl2.signal);

			assert.strictEqual(factoryCallCount, 1, 'factory must run exactly once despite distinct signals');

			d.resolve({ values: [] });
			await p1;
			await p2;
		});

		test('same-repoPath concurrent callers with different signals; first cancels; second still resolves', async () => {
			const cache = new Cache();
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));

			let factoryCallCount = 0;
			const d = deferred<PagedResult<GitBranch>>();
			let factorySignal: AbortSignal | undefined;
			const factory = (
				_commonPath: string,
				_cacheable: CacheController,
				signal?: AbortSignal,
			): Promise<PagedResult<GitBranch>> => {
				factoryCallCount++;
				factorySignal = signal;
				return d.promise;
			};
			const mapper = (b: PagedResult<GitBranch>): PagedResult<GitBranch> => b;

			const ctrl1 = new AbortController();
			const ctrl2 = new AbortController();

			const p1 = cache.getBranches('/code/project', factory, mapper, ctrl1.signal);
			const p2 = cache.getBranches('/code/project', factory, mapper, ctrl2.signal);

			assert.strictEqual(factoryCallCount, 1, 'same-repoPath concurrent callers must share one factory');

			ctrl1.abort();
			await flush();
			assert.strictEqual(
				factorySignal!.aborted,
				false,
				'aggregate must not fire while another waiter (p2) is active',
			);

			await assert.rejects(p1, (e: unknown) => e instanceof CancellationError);

			d.resolve({ values: [] });
			const result = await p2;
			assert.deepStrictEqual(result.values, []);
		});

		test('same-repoPath solo caller cancels; factory aborts', async () => {
			const cache = new Cache();
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));

			let factorySignal: AbortSignal | undefined;
			const d = deferred<PagedResult<GitBranch>>();
			const factory = (
				_commonPath: string,
				_cacheable: CacheController,
				signal?: AbortSignal,
			): Promise<PagedResult<GitBranch>> => {
				factorySignal = signal;
				return d.promise;
			};
			const mapper = (b: PagedResult<GitBranch>): PagedResult<GitBranch> => b;

			const ctrl = new AbortController();
			const p = cache.getBranches('/code/project', factory, mapper, ctrl.signal);

			ctrl.abort();
			await flush();

			assert.strictEqual(factorySignal!.aborted, true, 'solo caller cancelling must fire the factory aggregate');
			await assert.rejects(p, (e: unknown) => e instanceof CancellationError);

			// Resolve deferred to avoid dangling promise even though we've observed rejection
			d.resolve({ values: [] });
		});

		test('same-repoPath both callers cancel; factory aborts', async () => {
			const cache = new Cache();
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));

			let factorySignal: AbortSignal | undefined;
			const d = deferred<PagedResult<GitBranch>>();
			const factory = (
				_commonPath: string,
				_cacheable: CacheController,
				signal?: AbortSignal,
			): Promise<PagedResult<GitBranch>> => {
				factorySignal = signal;
				return d.promise;
			};
			const mapper = (b: PagedResult<GitBranch>): PagedResult<GitBranch> => b;

			const ctrl1 = new AbortController();
			const ctrl2 = new AbortController();

			const p1 = cache.getBranches('/code/project', factory, mapper, ctrl1.signal);
			const p2 = cache.getBranches('/code/project', factory, mapper, ctrl2.signal);

			ctrl1.abort();
			await flush();
			assert.strictEqual(factorySignal!.aborted, false);

			ctrl2.abort();
			await flush();
			assert.strictEqual(
				factorySignal!.aborted,
				true,
				'aggregate must fire once every cancellable waiter aborts',
			);

			await assert.rejects(p1, (e: unknown) => e instanceof CancellationError);
			await assert.rejects(p2, (e: unknown) => e instanceof CancellationError);

			d.resolve({ values: [] });
		});

		test('mapper receives an aggregate signal; internal work stays alive when one of two callers cancels', async () => {
			const cache = new Cache();
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));

			const d = deferred<PagedResult<GitBranch>>();
			const factory = (): Promise<PagedResult<GitBranch>> => d.promise;

			let mapperRuns = 0;
			let mapperSignal: AbortSignal | undefined;
			const mapper = (
				b: PagedResult<GitBranch>,
				_targetRepoPath: string,
				_commonPath: string,
				signal?: AbortSignal,
			): PagedResult<GitBranch> => {
				mapperRuns++;
				mapperSignal = signal;
				return b;
			};

			const ctrl1 = new AbortController();
			const ctrl2 = new AbortController();

			const p1 = cache.getBranches('/code/project', factory, mapper, ctrl1.signal);
			const p2 = cache.getBranches('/code/project', factory, mapper, ctrl2.signal);

			// Mapper hasn't run yet — factory is pending.
			assert.strictEqual(mapperRuns, 0);

			ctrl1.abort();
			await flush();

			// Resolve factory so mapper can run.
			d.resolve({ values: [{ name: 'main' } as unknown as GitBranch] });
			await assert.rejects(p1, (e: unknown) => e instanceof CancellationError);
			const result = await p2;
			assert.strictEqual(result.values.length, 1);

			// Mapper ran once (cached) with an aggregate signal that did NOT abort when only p1 did
			assert.strictEqual(mapperRuns, 1);
			assert.ok(mapperSignal != null, 'mapper must receive an aggregate signal from getOrCreate');
			assert.strictEqual(mapperSignal.aborted, false, 'mapper signal must stay alive while p2 waits');
		});

		test('mapper aggregate fires when every caller cancels', async () => {
			const cache = new Cache();
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));

			// Factory resolves instantly so the mapper stage becomes the in-flight stage.
			const factory = (): Promise<PagedResult<GitBranch>> =>
				Promise.resolve({ values: [{ name: 'main' } as unknown as GitBranch] });

			let mapperSignal: AbortSignal | undefined;
			const mapperDeferred = deferred<void>();
			const mapper = async (
				b: PagedResult<GitBranch>,
				_targetRepoPath: string,
				_commonPath: string,
				signal?: AbortSignal,
			): Promise<PagedResult<GitBranch>> => {
				mapperSignal = signal;
				await mapperDeferred.promise;
				return b;
			};

			const ctrl1 = new AbortController();
			const ctrl2 = new AbortController();

			const p1 = cache.getBranches('/code/project', factory, mapper, ctrl1.signal);
			const p2 = cache.getBranches('/code/project', factory, mapper, ctrl2.signal);

			// Let the factory resolve and the mapper start
			await flush();
			assert.ok(mapperSignal != null);
			assert.strictEqual(mapperSignal.aborted, false);

			ctrl1.abort();
			await flush();
			assert.strictEqual(mapperSignal.aborted, false, 'mapper aggregate must not fire until every caller aborts');

			ctrl2.abort();
			await flush();
			assert.strictEqual(mapperSignal.aborted, true, 'mapper aggregate must fire once every caller aborts');

			await assert.rejects(p1, (e: unknown) => e instanceof CancellationError);
			await assert.rejects(p2, (e: unknown) => e instanceof CancellationError);

			// Unblock mapper so its promise can settle and the test cleans up
			mapperDeferred.resolve();
		});

		test('permanent caller (no signal) keeps factory alive when cancellable caller aborts', async () => {
			const cache = new Cache();
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));

			let factorySignal: AbortSignal | undefined;
			const d = deferred<PagedResult<GitBranch>>();
			const factory = (
				_commonPath: string,
				_cacheable: CacheController,
				signal?: AbortSignal,
			): Promise<PagedResult<GitBranch>> => {
				factorySignal = signal;
				return d.promise;
			};
			const mapper = (b: PagedResult<GitBranch>): PagedResult<GitBranch> => b;

			// Permanent caller first (no signal)
			const permanent = cache.getBranches('/code/project', factory, mapper);

			// Cancellable caller second
			const ctrl = new AbortController();
			const cancellable = cache.getBranches('/code/project', factory, mapper, ctrl.signal);

			ctrl.abort();
			await flush();
			assert.strictEqual(factorySignal!.aborted, false, 'permanent slot must keep aggregate alive');

			await assert.rejects(cancellable, (e: unknown) => e instanceof CancellationError);

			d.resolve({ values: [] });
			const result = await permanent;
			assert.deepStrictEqual(result.values, []);
		});

		test('clearCaches during in-flight soft-invalidates; waiter still resolves; next caller joins in-flight', async () => {
			const cache = new Cache();
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));

			let factoryCallCount = 0;
			const d = deferred<PagedResult<GitBranch>>();
			const factory = (_commonPath: string, _cacheable: CacheController): Promise<PagedResult<GitBranch>> => {
				factoryCallCount++;
				return d.promise;
			};
			const mapper = (b: PagedResult<GitBranch>): PagedResult<GitBranch> => b;

			const p1 = cache.getBranches('/code/project', factory, mapper);

			// Soft-invalidate while factory is still pending
			cache.clearCaches('/code/project', 'branches');

			// New caller during in-flight must share the same pending promise, not trigger a new factory
			const p2 = cache.getBranches('/code/project', factory, mapper);
			assert.strictEqual(
				factoryCallCount,
				1,
				'in-flight soft-invalidated entry must still dedup concurrent callers',
			);

			// Existing waiter still resolves with the in-flight value
			d.resolve({ values: [] });
			await p1;
			await p2;

			// After settle, the entry is evicted: next caller spawns a fresh factory
			await Promise.resolve();
			await Promise.resolve();
			const d2 = deferred<PagedResult<GitBranch>>();
			const p3 = cache.getBranches(
				'/code/project',
				() => {
					factoryCallCount++;
					return d2.promise;
				},
				mapper,
			);
			assert.strictEqual(factoryCallCount, 2);
			d2.resolve({ values: [] });
			await p3;
		});

		test('getBranches shares cache when main repo queries first', async () => {
			const cache = new Cache();

			// Register main repo and worktree
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));
			cache.registerRepoPath(
				createMockUri('/code/project-feature'),
				createMockGitDir(createMockUri('/code/project/.git')),
			);

			let factoryCallCount = 0;
			let mapperCallCount = 0;

			type MockBranch = { name: string; repoPath: string };
			const factory = (commonPath: string): PagedResult<GitBranch> => {
				factoryCallCount++;
				return { values: [{ name: 'main', repoPath: commonPath }] } as unknown as PagedResult<GitBranch>;
			};

			const mapper = (
				branches: PagedResult<GitBranch>,
				targetRepoPath: string,
				_commonPath: string,
			): PagedResult<GitBranch> => {
				mapperCallCount++;
				const mockBranches = branches.values as unknown as MockBranch[];
				return {
					values: mockBranches.map(b => ({ ...b, repoPath: targetRepoPath })),
				} as unknown as PagedResult<GitBranch>;
			};

			// Fetch from main repo first
			const result1 = await cache.getBranches('/code/project', factory, mapper);
			assert.strictEqual(factoryCallCount, 1);
			assert.strictEqual(mapperCallCount, 1);
			assert.strictEqual((result1.values[0] as unknown as MockBranch).repoPath, '/code/project');

			// Fetch from worktree - should use shared factory data
			const result2 = await cache.getBranches('/code/project-feature', factory, mapper);
			assert.strictEqual(factoryCallCount, 1); // No additional factory call
			assert.strictEqual(mapperCallCount, 2); // Mapper called for worktree
			assert.strictEqual((result2.values[0] as unknown as MockBranch).repoPath, '/code/project-feature');

			// Second call from worktree uses mapped cache
			void (await cache.getBranches('/code/project-feature', factory, mapper));
			assert.strictEqual(factoryCallCount, 1);
			assert.strictEqual(mapperCallCount, 2); // No additional call
		});
	});
});
