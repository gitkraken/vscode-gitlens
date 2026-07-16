import * as assert from 'assert';
import { AbortAggregate, isCancellationError, raceWithTimeout } from '../cancellation.js';

suite('raceWithTimeout', () => {
	test('rejects with a CancellationError if the promise does not settle within ms', async () => {
		const neverSettles = new Promise<number>(() => {});
		await assert.rejects(raceWithTimeout(neverSettles, 10), (e: unknown) => isCancellationError(e));
	});

	test('resolves with the value when the promise settles in time', async () => {
		assert.strictEqual(await raceWithTimeout(Promise.resolve(42), 10_000), 42);
	});

	test('propagates the original rejection when the promise fails in time', async () => {
		const err = new Error('boom');
		await assert.rejects(raceWithTimeout(Promise.reject(err), 10_000), (e: unknown) => e === err);
	});

	test('aborts the linked controller on timeout so the underlying op can be torn down', async () => {
		const controller = new AbortController();
		const neverSettles = new Promise<number>(() => {});
		await assert.rejects(raceWithTimeout(neverSettles, 10, controller), (e: unknown) => isCancellationError(e));
		assert.strictEqual(controller.signal.aborted, true, 'the linked controller is aborted on timeout');
	});

	test('does not abort the linked controller when the promise settles in time', async () => {
		const controller = new AbortController();
		assert.strictEqual(await raceWithTimeout(Promise.resolve(7), 10_000, controller), 7);
		assert.strictEqual(controller.signal.aborted, false);
	});
});

suite('AbortAggregate', () => {
	test('the aggregate signal aborts only when all added signals abort', () => {
		const agg = new AbortAggregate();
		const a = new AbortController();
		const b = new AbortController();
		agg.add(a.signal);
		agg.add(b.signal);
		assert.strictEqual(agg.signal.aborted, false);
		a.abort();
		assert.strictEqual(agg.signal.aborted, false, 'still one active caller');
		b.abort();
		assert.strictEqual(agg.signal.aborted, true, 'all callers cancelled');
	});

	test('adding the same signal twice cleans up both listeners (no leak)', () => {
		const agg = new AbortAggregate();
		let added = 0;
		let removed = 0;
		const listeners = new Set<() => void>();
		// A minimal AbortSignal stand-in that counts listener registrations.
		const fakeSignal = {
			aborted: false,
			addEventListener: (_type: string, cb: () => void) => {
				added++;
				listeners.add(cb);
			},
			removeEventListener: (_type: string, cb: () => void) => {
				removed++;
				listeners.delete(cb);
			},
		} as unknown as AbortSignal;

		const cleanup1 = agg.add(fakeSignal);
		const cleanup2 = agg.add(fakeSignal);
		assert.strictEqual(added, 2, 'each registration adds its own listener');

		cleanup1();
		cleanup2();
		assert.strictEqual(removed, 2, 'each registration removes its own listener');
		assert.strictEqual(listeners.size, 0, 'no listener remains attached (no leak)');
	});
});
