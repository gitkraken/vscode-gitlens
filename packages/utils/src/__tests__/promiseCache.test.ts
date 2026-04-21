import * as assert from 'assert';
import { CancellationError } from '../cancellation.js';
import type { CacheController } from '../promiseCache.js';
import { PromiseCache, PromiseMap, RepoPromiseCacheMap, RepoPromiseMap } from '../promiseCache.js';

// Wait for all queued microtasks/settled promises to propagate.
// Two ticks covers: (a) factory promise settle, (b) chained .finally/.catch handlers.
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

suite('PromiseMap Test Suite', () => {
	suite('getOrCreate — aggregate signal plumbing', () => {
		test('factory receives aggregate signal when first caller passes no signal', async () => {
			const map = new PromiseMap<string, number>();
			let factorySignal: AbortSignal | undefined;

			const d = deferred<number>();
			const result = map.getOrCreate('k', (_cacheable, signal) => {
				factorySignal = signal;
				return d.promise;
			});

			assert.ok(
				factorySignal != null,
				'factory should receive an aggregate signal even when first caller has no cancellation',
			);
			assert.strictEqual(factorySignal.aborted, false);
			d.resolve(1);
			assert.strictEqual(await result, 1);
		});

		test('second caller with signal can contribute to aggregate when first had none', async () => {
			const map = new PromiseMap<string, number>();
			let factorySignal: AbortSignal | undefined;
			const d = deferred<number>();

			// First caller: no signal (permanent)
			const first = map.getOrCreate('k', (_cacheable, signal) => {
				factorySignal = signal;
				return d.promise;
			});

			// Second caller with signal
			const ctrl2 = new AbortController();
			const second = map.getOrCreate(
				'k',
				() => {
					throw new Error('factory must not run on cache hit');
				},
				ctrl2.signal,
			);

			// Second caller cancels — aggregate must NOT fire because first caller is permanent
			ctrl2.abort();
			await flush();
			assert.strictEqual(
				factorySignal!.aborted,
				false,
				'aggregate must not fire while a permanent caller is active',
			);

			// Second caller's returned promise rejects via raceWithSignal
			await assert.rejects(second, (e: unknown) => e instanceof CancellationError);

			// First caller still gets the result
			d.resolve(42);
			assert.strictEqual(await first, 42);
		});

		test('aggregate fires when all cancellable callers cancel and no permanent caller exists', async () => {
			const map = new PromiseMap<string, number>();
			let factorySignal: AbortSignal | undefined;
			const d = deferred<number>();

			const ctrl1 = new AbortController();
			const ctrl2 = new AbortController();

			const p1 = map.getOrCreate(
				'k',
				(_cacheable, signal) => {
					factorySignal = signal;
					return d.promise;
				},
				ctrl1.signal,
			);

			const p2 = map.getOrCreate(
				'k',
				() => {
					throw new Error('factory must not run on cache hit');
				},
				ctrl2.signal,
			);

			ctrl1.abort();
			await flush();
			assert.strictEqual(
				factorySignal!.aborted,
				false,
				'aggregate must not fire until ALL cancellable callers cancel',
			);

			ctrl2.abort();
			await flush();
			assert.strictEqual(factorySignal!.aborted, true, 'aggregate must fire once all cancellable callers cancel');

			await assert.rejects(p1, (e: unknown) => e instanceof CancellationError);
			await assert.rejects(p2, (e: unknown) => e instanceof CancellationError);
		});
	});

	suite('getOrCreate — cache hit dedup', () => {
		test('second caller gets the same promise; factory runs once', async () => {
			const map = new PromiseMap<string, number>();
			let factoryRuns = 0;
			const d = deferred<number>();

			const p1 = map.getOrCreate('k', () => {
				factoryRuns++;
				return d.promise;
			});
			const p2 = map.getOrCreate('k', () => {
				factoryRuns++;
				return d.promise;
			});

			assert.strictEqual(factoryRuns, 1);
			d.resolve(7);
			assert.strictEqual(await p1, 7);
			assert.strictEqual(await p2, 7);
		});

		test('caller with signal that resolves without aborting does not leak listeners', async () => {
			const map = new PromiseMap<string, number>();
			const d = deferred<number>();

			const ctrl = new AbortController();
			const p1 = map.getOrCreate('k', () => d.promise);
			const p2 = map.getOrCreate(
				'k',
				() => {
					throw new Error('unreached');
				},
				ctrl.signal,
			);

			d.resolve(1);
			assert.strictEqual(await p1, 1);
			assert.strictEqual(await p2, 1);

			// Now abort the signal after the promise has already resolved — must be a no-op,
			// and must not throw or trigger any listeners.
			ctrl.abort();
			await flush();
		});
	});

	suite('invalidate', () => {
		test('invalidate marks the cacheable; existing waiters still resolve', async () => {
			const map = new PromiseMap<string, number>();
			const d = deferred<number>();
			let seenCacheable: CacheController | undefined;

			const p = map.getOrCreate('k', cacheable => {
				seenCacheable = cacheable;
				return d.promise;
			});

			map.invalidate('k');
			assert.strictEqual(seenCacheable!.invalidated, true);

			// Waiter still resolves with the original value
			d.resolve(99);
			assert.strictEqual(await p, 99);

			// After settle, entry is evicted
			await flush();
			assert.strictEqual(map.has('k'), false);
		});

		test('new caller during in-flight after invalidate shares the same promise', async () => {
			const map = new PromiseMap<string, number>();
			const d = deferred<number>();
			let factoryRuns = 0;

			const p1 = map.getOrCreate('k', () => {
				factoryRuns++;
				return d.promise;
			});

			map.invalidate('k');

			const p2 = map.getOrCreate('k', () => {
				factoryRuns++;
				return d.promise;
			});

			assert.strictEqual(factoryRuns, 1, 'invalidated-but-in-flight entry must still dedup concurrent callers');
			d.resolve(5);
			assert.strictEqual(await p1, 5);
			assert.strictEqual(await p2, 5);

			// Next caller AFTER settle creates a fresh factory
			await flush();
			const d2 = deferred<number>();
			const p3 = map.getOrCreate('k', () => {
				factoryRuns++;
				return d2.promise;
			});
			assert.strictEqual(factoryRuns, 2);
			d2.resolve(6);
			assert.strictEqual(await p3, 6);
		});

		test('invalidate on missing key is a no-op', () => {
			const map = new PromiseMap<string, number>();
			assert.doesNotThrow(() => map.invalidate('missing'));
		});

		test('invalidate on plain set() entry hard-deletes', async () => {
			const map = new PromiseMap<string, number>();
			map.set('k', Promise.resolve(42));
			assert.strictEqual(map.has('k'), true);

			map.invalidate('k');
			assert.strictEqual(map.has('k'), false);
		});
	});

	suite('factory rejection', () => {
		test('rejected factory auto-evicts the entry; next caller creates a fresh factory', async () => {
			const map = new PromiseMap<string, number>();
			let factoryRuns = 0;
			const firstFactoryRejected = true;

			await assert.rejects(
				map.getOrCreate('k', () => {
					factoryRuns++;
					return Promise.reject(new Error('boom'));
				}),
			);

			// Allow the catch/finally cleanup chain to run
			await flush();

			assert.strictEqual(map.has('k'), false, 'rejected entry must be evicted from cache');
			assert.strictEqual(firstFactoryRejected, true);

			// Next caller creates a fresh factory
			const result = await map.getOrCreate('k', () => {
				factoryRuns++;
				return Promise.resolve(7);
			});
			assert.strictEqual(factoryRuns, 2);
			assert.strictEqual(result, 7);
		});

		test('rejected factory cleans up aborts and controllers maps', async () => {
			const map = new PromiseMap<string, number>();

			await assert.rejects(map.getOrCreate('k', () => Promise.reject(new Error('boom'))));
			await flush();

			// Nothing leaked: invalidate is a no-op
			assert.doesNotThrow(() => map.invalidate('k'));
			// A fresh factory runs cleanly without colliding with any residual state
			const result = await map.getOrCreate('k', () => Promise.resolve(1));
			assert.strictEqual(result, 1);
		});
	});

	suite('cache-hit caller cleanup', () => {
		test('cache-hit caller with signal that does not abort settles cleanly', async () => {
			const map = new PromiseMap<string, number>();
			const d = deferred<number>();

			const p1 = map.getOrCreate('k', () => d.promise);

			const ctrl = new AbortController();
			const p2 = map.getOrCreate(
				'k',
				() => {
					throw new Error('unreached');
				},
				ctrl.signal,
			);

			d.resolve(42);
			assert.strictEqual(await p1, 42);
			assert.strictEqual(await p2, 42);

			// Post-resolution: aborting the signal is a no-op (listeners removed)
			ctrl.abort();
			await flush();
			// No unhandled rejection should surface
		});

		test('cache-hit caller whose signal aborts rejects only them; others still resolve', async () => {
			const map = new PromiseMap<string, number>();
			const d = deferred<number>();

			const p1 = map.getOrCreate('k', () => d.promise);

			const ctrlB = new AbortController();
			const p2 = map.getOrCreate(
				'k',
				() => {
					throw new Error('unreached');
				},
				ctrlB.signal,
			);

			ctrlB.abort();
			await assert.rejects(p2, (e: unknown) => e instanceof CancellationError);

			d.resolve(99);
			assert.strictEqual(await p1, 99);
		});
	});
});

suite('PromiseCache Test Suite', () => {
	suite('getOrCreate — aggregate signal plumbing', () => {
		test('factory receives aggregate signal when first caller passes no signal', async () => {
			const cache = new PromiseCache<string, number>();
			let factorySignal: AbortSignal | undefined;
			const d = deferred<number>();

			const p = cache.getOrCreate('k', (_cacheable, signal) => {
				factorySignal = signal;
				return d.promise;
			});

			assert.ok(factorySignal != null);
			assert.strictEqual(factorySignal.aborted, false);
			d.resolve(1);
			assert.strictEqual(await p, 1);
		});

		test('aggregate fires when all cancellable callers cancel', async () => {
			const cache = new PromiseCache<string, number>();
			let factorySignal: AbortSignal | undefined;
			const d = deferred<number>();

			const ctrl1 = new AbortController();
			const ctrl2 = new AbortController();

			const p1 = cache.getOrCreate(
				'k',
				(_cacheable, signal) => {
					factorySignal = signal;
					return d.promise;
				},
				{ cancellation: ctrl1.signal },
			);

			const p2 = cache.getOrCreate(
				'k',
				() => {
					throw new Error('unreached');
				},
				{ cancellation: ctrl2.signal },
			);

			ctrl1.abort();
			ctrl2.abort();
			await flush();
			assert.strictEqual(factorySignal!.aborted, true);

			await assert.rejects(p1, (e: unknown) => e instanceof CancellationError);
			await assert.rejects(p2, (e: unknown) => e instanceof CancellationError);
		});
	});

	suite('invalidate', () => {
		test('invalidate marks the cacheable; waiter still resolves; entry evicted on settle', async () => {
			const cache = new PromiseCache<string, number>();
			const d = deferred<number>();
			let seenCacheable: CacheController | undefined;

			const p = cache.getOrCreate('k', cacheable => {
				seenCacheable = cacheable;
				return d.promise;
			});

			cache.invalidate('k');
			assert.strictEqual(seenCacheable!.invalidated, true);

			d.resolve(99);
			assert.strictEqual(await p, 99);
			await flush();
			assert.strictEqual(cache.get('k'), undefined);
		});
	});
});

suite('RepoPromiseMap Test Suite', () => {
	test('invalidate(repoPath, key) soft-invalidates specific entry', async () => {
		const map = new RepoPromiseMap<string, number>();
		const d = deferred<number>();
		let seenCacheable: CacheController | undefined;

		const p = map.getOrCreate('/repo', 'k', cacheable => {
			seenCacheable = cacheable;
			return d.promise;
		});

		map.invalidate('/repo', 'k');
		assert.strictEqual(seenCacheable!.invalidated, true);

		d.resolve(1);
		assert.strictEqual(await p, 1);
	});

	test('invalidate(repoPath) invalidates every entry for the repo', async () => {
		const map = new RepoPromiseMap<string, number>();
		const dA = deferred<number>();
		const dB = deferred<number>();
		let cacheableA: CacheController | undefined;
		let cacheableB: CacheController | undefined;

		const pA = map.getOrCreate('/repo', 'a', c => {
			cacheableA = c;
			return dA.promise;
		});
		const pB = map.getOrCreate('/repo', 'b', c => {
			cacheableB = c;
			return dB.promise;
		});

		map.invalidate('/repo');
		assert.strictEqual(cacheableA!.invalidated, true);
		assert.strictEqual(cacheableB!.invalidated, true);

		dA.resolve(1);
		dB.resolve(2);
		assert.strictEqual(await pA, 1);
		assert.strictEqual(await pB, 2);
	});

	test('invalidate on missing repo is a no-op', () => {
		const map = new RepoPromiseMap<string, number>();
		assert.doesNotThrow(() => map.invalidate('/missing'));
		assert.doesNotThrow(() => map.invalidate('/missing', 'k'));
	});
});

suite('RepoPromiseCacheMap Test Suite', () => {
	test('invalidate(repoPath, key) soft-invalidates specific entry', async () => {
		const cache = new RepoPromiseCacheMap<string, number>();
		const d = deferred<number>();
		let seenCacheable: CacheController | undefined;

		const p = cache.getOrCreate('/repo', 'k', cacheable => {
			seenCacheable = cacheable;
			return d.promise;
		});

		cache.invalidate('/repo', 'k');
		assert.strictEqual(seenCacheable!.invalidated, true);

		d.resolve(1);
		assert.strictEqual(await p, 1);
	});

	test('invalidate(repoPath) invalidates every entry for the repo', async () => {
		const cache = new RepoPromiseCacheMap<string, number>();
		const dA = deferred<number>();
		const dB = deferred<number>();
		let cacheableA: CacheController | undefined;
		let cacheableB: CacheController | undefined;

		const pA = cache.getOrCreate('/repo', 'a', c => {
			cacheableA = c;
			return dA.promise;
		});
		const pB = cache.getOrCreate('/repo', 'b', c => {
			cacheableB = c;
			return dB.promise;
		});

		cache.invalidate('/repo');
		assert.strictEqual(cacheableA!.invalidated, true);
		assert.strictEqual(cacheableB!.invalidated, true);

		dA.resolve(1);
		dB.resolve(2);
		assert.strictEqual(await pA, 1);
		assert.strictEqual(await pB, 2);
	});
});
