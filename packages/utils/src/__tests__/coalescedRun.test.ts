import * as assert from 'assert';
import { CoalescedRun } from '../coalescedRun.js';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise: promise, resolve: resolve, reject: reject };
}

// `run()` defers `fn` a microtask (`Promise.resolve().then(fn)`) and then chains `.finally(...)` —
// each hop is its own microtask, so a handful of ticks reliably drains the whole chain.
async function flush(): Promise<void> {
	for (let i = 0; i < 6; i++) {
		await Promise.resolve();
	}
}

suite('CoalescedRun Test Suite', () => {
	test('concurrent run calls while in flight join the same promise (fn invoked once)', async () => {
		const d = deferred<number>();
		let calls = 0;
		let refires = 0;
		const coalesced = new CoalescedRun<number>(
			() => {
				calls++;
				return d.promise;
			},
			() => refires++,
		);

		const p1 = coalesced.run();
		const p2 = coalesced.run();
		assert.strictEqual(p1, p2, 'concurrent callers must receive the SAME promise instance');
		assert.strictEqual(coalesced.running, true);

		await flush();
		assert.strictEqual(calls, 1, 'fn should be invoked exactly once across concurrent callers');

		d.resolve(1);
		const [v1, v2] = await Promise.all([p1, p2]);
		assert.strictEqual(v1, 1);
		assert.strictEqual(v2, 1);
		assert.strictEqual(calls, 1);

		await flush();
		assert.strictEqual(refires, 1, 'the second, joining call marks the run dirty for one trailing refire');
	});

	test('a run call while in flight triggers exactly one trailing refire after settle', async () => {
		const d = deferred<number>();
		let calls = 0;
		let refires = 0;
		const coalesced = new CoalescedRun<number>(
			() => {
				calls++;
				return d.promise;
			},
			() => refires++,
		);

		void coalesced.run();
		// Joins the in-flight promise and marks it dirty rather than invoking fn again.
		void coalesced.run();
		void coalesced.run();
		await flush();
		assert.strictEqual(calls, 1);

		d.resolve(1);
		await flush();

		assert.strictEqual(refires, 1, 'exactly one trailing refire regardless of how many calls arrived mid-flight');
		assert.strictEqual(coalesced.running, false);
	});

	test('rejection still clears inflight and refires when dirty', async () => {
		const d = deferred<number>();
		let refires = 0;
		const failure = new Error('boom');
		const coalesced = new CoalescedRun<number>(
			() => d.promise,
			() => refires++,
		);

		const p1 = coalesced.run();
		void coalesced.run();

		d.reject(failure);
		await assert.rejects(p1, (e: unknown) => e === failure);
		await flush();

		assert.strictEqual(refires, 1, 'a rejection still fires the trailing refire when dirty');
		assert.strictEqual(coalesced.running, false);
	});

	test('clean completion (no calls while running) does not refire', async () => {
		let refires = 0;
		const coalesced = new CoalescedRun<number>(
			() => Promise.resolve(1),
			() => refires++,
		);

		await coalesced.run();
		await flush();

		assert.strictEqual(refires, 0);
		assert.strictEqual(coalesced.running, false);
	});

	test('refire fires after inflight is cleared — a run inside refire starts fresh', async () => {
		const d = deferred<number>();
		let fnCalls = 0;
		let observedRunningInRefire: boolean | undefined;
		const coalesced = new CoalescedRun<number>(
			() => {
				fnCalls++;
				return fnCalls === 1 ? d.promise : Promise.resolve(2);
			},
			() => {
				observedRunningInRefire = coalesced.running;
				void coalesced.run();
			},
		);

		void coalesced.run();
		void coalesced.run();

		d.resolve(1);
		await flush();

		assert.strictEqual(observedRunningInRefire, false, 'inflight must be cleared before refire is invoked');
		assert.strictEqual(fnCalls, 2, 'the refire-triggered run must actually invoke fn again (fresh run)');
	});

	test('a synchronous reentrant run() from within fn joins instead of double-running', async () => {
		const d = deferred<number>();
		let calls = 0;
		let refires = 0;
		let reentrantPromise: Promise<number> | undefined;
		const coalesced = new CoalescedRun<number>(
			() => {
				calls++;
				// A reentrant call from fn's own prologue — `_inflight` must already be assigned by now.
				reentrantPromise = coalesced.run();
				return d.promise;
			},
			() => refires++,
		);

		const p1 = coalesced.run();
		await flush();

		assert.strictEqual(calls, 1, 'fn must run exactly once even though it re-entered run() synchronously');
		assert.strictEqual(reentrantPromise, p1, 'the reentrant call must join the SAME in-flight promise');

		d.resolve(1);
		await flush();

		assert.strictEqual(refires, 1, 'the reentrant join marks the run dirty for one trailing refire');
	});

	test('markDirty() while running forces a trailing refire; while idle it is a no-op', async () => {
		// Idle: no in-flight run — markDirty() must be dropped rather than poisoning the next run.
		let idleRefires = 0;
		const idleCoalesced = new CoalescedRun<number>(
			() => Promise.resolve(1),
			() => idleRefires++,
		);
		idleCoalesced.markDirty();
		assert.strictEqual(idleCoalesced.running, false);
		await idleCoalesced.run();
		await flush();
		assert.strictEqual(idleRefires, 0, 'an idle markDirty() must not force a refire on the next run');

		// Running: markDirty() while in flight (with no joining `run()` call) still forces exactly
		// one trailing refire once the run settles.
		const d = deferred<number>();
		let runningRefires = 0;
		const runningCoalesced = new CoalescedRun<number>(
			() => d.promise,
			() => runningRefires++,
		);
		const p1 = runningCoalesced.run();
		runningCoalesced.markDirty();

		d.resolve(1);
		await p1;
		await flush();

		assert.strictEqual(runningRefires, 1, 'markDirty() while running forces the trailing refire');
	});
});
