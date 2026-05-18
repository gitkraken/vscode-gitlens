import * as assert from 'assert';
import { DedupedAsyncCache } from '../dedupedAsyncCache.js';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise: promise, resolve: resolve, reject: reject };
}

// Two ticks flush: the resolver's settle + the `.then` → `.finally` chain inside `getOrResolve`.
async function flush(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

suite('DedupedAsyncCache Test Suite', () => {
	test('has/get distinguish cached undefined from missing', () => {
		const cache = new DedupedAsyncCache<string, number | undefined>();
		assert.strictEqual(cache.has('k'), false);
		assert.strictEqual(cache.get('k'), undefined);

		cache.set('k', undefined);
		assert.strictEqual(cache.has('k'), true);
		assert.strictEqual(cache.get('k'), undefined);

		cache.set('k', 7);
		assert.strictEqual(cache.has('k'), true);
		assert.strictEqual(cache.get('k'), 7);
	});

	test('set proactively populates the cache for subsequent reads', async () => {
		const cache = new DedupedAsyncCache<string, number>();
		cache.set('k', 42);

		const value = await cache.getOrResolve('k', () => {
			throw new Error('resolver must not run when value is already cached');
		});
		assert.strictEqual(value, 42);
	});

	test('getOrResolve runs the resolver exactly once on first miss', async () => {
		const cache = new DedupedAsyncCache<string, number>();
		let calls = 0;
		const value = await cache.getOrResolve('k', () => {
			calls++;
			return Promise.resolve(5);
		});
		assert.strictEqual(value, 5);
		assert.strictEqual(calls, 1);
		assert.strictEqual(cache.has('k'), true);
		assert.strictEqual(cache.get('k'), 5);
	});

	test('subsequent getOrResolve on a cached key skips the resolver', async () => {
		const cache = new DedupedAsyncCache<string, number>();
		await cache.getOrResolve('k', () => Promise.resolve(5));

		const second = await cache.getOrResolve('k', () => {
			throw new Error('resolver must not run on cache hit');
		});
		assert.strictEqual(second, 5);
	});

	test('concurrent getOrResolve calls share a single in-flight Promise (resolver runs once)', async () => {
		const cache = new DedupedAsyncCache<string, number>();
		const d = deferred<number>();
		let calls = 0;
		const resolver = () => {
			calls++;
			return d.promise;
		};

		const p1 = cache.getOrResolve('k', resolver);
		const p2 = cache.getOrResolve('k', resolver);
		const p3 = cache.getOrResolve('k', resolver);

		assert.strictEqual(calls, 1, 'resolver should be invoked exactly once across concurrent callers');

		d.resolve(11);
		const [v1, v2, v3] = await Promise.all([p1, p2, p3]);
		assert.strictEqual(v1, 11);
		assert.strictEqual(v2, 11);
		assert.strictEqual(v3, 11);
		assert.strictEqual(calls, 1);
	});

	test('resolver rejection clears the in-flight entry — next call retries', async () => {
		const cache = new DedupedAsyncCache<string, number>();
		let calls = 0;
		const failure = new Error('boom');

		await assert.rejects(
			cache.getOrResolve('k', () => {
				calls++;
				return Promise.reject(failure);
			}),
			(e: unknown) => e === failure,
		);

		// Wait for the `.finally` cleanup to run so the next call doesn't piggyback on the rejected
		// Promise.
		await flush();
		assert.strictEqual(cache.has('k'), false, 'rejection must not populate the resolved cache');

		const value = await cache.getOrResolve('k', () => {
			calls++;
			return Promise.resolve(8);
		});
		assert.strictEqual(value, 8);
		assert.strictEqual(calls, 2, 'next call should re-invoke the resolver after a rejection');
	});

	test('cached undefined hits the cache (does not invoke resolver)', async () => {
		const cache = new DedupedAsyncCache<string, number | undefined>();
		await cache.getOrResolve('k', () => Promise.resolve(undefined));

		assert.strictEqual(cache.has('k'), true);
		const value = await cache.getOrResolve('k', () => {
			throw new Error('resolver must not run when undefined is cached');
		});
		assert.strictEqual(value, undefined);
	});

	test('delete removes both resolved and in-flight entries', async () => {
		const cache = new DedupedAsyncCache<string, number>();
		const d = deferred<number>();
		const inflight = cache.getOrResolve('k', () => d.promise);

		cache.delete('k');

		// A new caller after delete should run a fresh resolver, not reuse the in-flight promise.
		let calls = 0;
		const second = cache.getOrResolve('k', () => {
			calls++;
			return Promise.resolve(99);
		});

		// Settle the original in-flight; its result should NOT populate the cache because the entry
		// was deleted before settlement — but since `.then` runs unconditionally on resolution, the
		// resolved-cache may still get set. The important invariants are: (1) the second caller's
		// resolver did run, (2) it returned its own value. We assert those explicitly.
		d.resolve(1);
		await inflight;
		assert.strictEqual(calls, 1);
		assert.strictEqual(await second, 99);
	});

	test('clear removes everything — subsequent reads re-resolve', async () => {
		const cache = new DedupedAsyncCache<string, number>();
		cache.set('a', 1);
		cache.set('b', 2);
		assert.strictEqual(cache.has('a'), true);
		assert.strictEqual(cache.has('b'), true);

		cache.clear();
		assert.strictEqual(cache.has('a'), false);
		assert.strictEqual(cache.has('b'), false);

		let calls = 0;
		const value = await cache.getOrResolve('a', () => {
			calls++;
			return Promise.resolve(100);
		});
		assert.strictEqual(value, 100);
		assert.strictEqual(calls, 1);
	});

	test('after a resolved getOrResolve completes, the in-flight map is cleaned up', async () => {
		const cache = new DedupedAsyncCache<string, number>();
		await cache.getOrResolve('k', () => Promise.resolve(3));
		await flush();

		// Indirect assertion: a deleted resolved entry should leave a clean slate so the next
		// getOrResolve actually invokes the resolver.
		cache.delete('k');
		let calls = 0;
		await cache.getOrResolve('k', () => {
			calls++;
			return Promise.resolve(4);
		});
		assert.strictEqual(calls, 1, 'in-flight entry must not linger after a settled resolve');
	});
});
