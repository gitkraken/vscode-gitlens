import * as assert from 'assert';
import { Emitter, once, promisifyDeferred, take, weakEvent } from '../event.js';

suite('Emitter Test Suite', () => {
	test('Basic subscription and firing', () => {
		const emitter = new Emitter<string>();
		let received: string | undefined;

		emitter.event(e => {
			received = e;
		});

		emitter.fire('hello');
		assert.strictEqual(received, 'hello');
	});

	test('Multiple listeners', () => {
		const emitter = new Emitter<number>();
		let count = 0;

		emitter.event(() => count++);
		emitter.event(() => count++);

		emitter.fire(1);
		assert.strictEqual(count, 2);
	});

	test('Dispose listener', () => {
		const emitter = new Emitter<string>();
		let count = 0;

		const disposable = emitter.event(() => count++);

		emitter.fire('first');
		assert.strictEqual(count, 1);

		disposable.dispose();

		emitter.fire('second');
		assert.strictEqual(count, 1);
	});

	test('thisArgs support', () => {
		const emitter = new Emitter<void>();
		const context = { value: 42 };
		let receivedContext: any;

		emitter.event(function (this: any) {
			// eslint-disable-next-line @typescript-eslint/no-this-alias
			receivedContext = this;
		}, context);

		emitter.fire();
		assert.strictEqual(receivedContext, context);
		assert.strictEqual(receivedContext.value, 42);
	});

	test('Disposables list', () => {
		const emitter = new Emitter<void>();
		const disposables: any[] = [];

		emitter.event(() => {}, undefined, disposables);

		assert.strictEqual(disposables.length, 1);
		assert.ok(typeof disposables[0].dispose === 'function');
	});

	test('Error handling in listener', () => {
		const emitter = new Emitter<void>();
		let secondListenerRun = false;

		emitter.event(() => {
			throw new Error('Boom');
		});

		emitter.event(() => {
			secondListenerRun = true;
		});

		// Should not throw and should continue to next listener
		// Note: The console.error might show up in test output
		emitter.fire();

		assert.strictEqual(secondListenerRun, true);
	});

	test('Dispose emitter', () => {
		const emitter = new Emitter<void>();
		let count = 0;
		emitter.event(() => count++);

		emitter.fire();
		assert.strictEqual(count, 1);

		emitter.dispose();

		// Event access after dispose should return None/noop
		const d = emitter.event(() => count++);
		d.dispose(); // Should be safe

		// Fire should do nothing
		emitter.fire();
		assert.strictEqual(count, 1);
	});
});

suite('once', () => {
	test('fires listener exactly once then auto-disposes', () => {
		const emitter = new Emitter<number>();
		let count = 0;
		let last: number | undefined;

		once(emitter.event)(e => {
			count++;
			last = e;
		});

		emitter.fire(1);
		emitter.fire(2);
		emitter.fire(3);

		assert.strictEqual(count, 1);
		assert.strictEqual(last, 1);
	});

	test('supports thisArgs', () => {
		const emitter = new Emitter<void>();
		const ctx = { called: false };

		once(emitter.event)(function (this: typeof ctx) {
			this.called = true;
		}, ctx);

		emitter.fire();
		assert.strictEqual(ctx.called, true);
	});
});

suite('take', () => {
	test('fires listener N times then auto-disposes', () => {
		const emitter = new Emitter<number>();
		const received: number[] = [];

		take(
			emitter.event,
			3,
		)(e => {
			received.push(e);
		});

		emitter.fire(1);
		emitter.fire(2);
		emitter.fire(3);
		emitter.fire(4);
		emitter.fire(5);

		assert.deepStrictEqual(received, [1, 2, 3]);
	});

	test('take(event, 1) behaves like once', () => {
		const emitter = new Emitter<string>();
		let count = 0;

		take(emitter.event, 1)(() => count++);

		emitter.fire('a');
		emitter.fire('b');

		assert.strictEqual(count, 1);
	});
});

suite('promisifyDeferred', () => {
	test('resolves on next event with default executor', async () => {
		const emitter = new Emitter<string>();
		const deferred = promisifyDeferred(emitter.event);

		assert.strictEqual(deferred.pending, true);

		emitter.fire('hello');

		const result = await deferred.promise;
		assert.strictEqual(result, 'hello');
		assert.strictEqual(deferred.pending, false);
	});

	test('resolves with custom executor', async () => {
		const emitter = new Emitter<number>();
		const deferred = promisifyDeferred<number, string>(emitter.event, (value, resolve) => {
			if (value > 5) {
				resolve(`big:${value}`);
			}
		});

		emitter.fire(3); // Should not resolve
		assert.strictEqual(deferred.pending, true);

		emitter.fire(10); // Should resolve
		const result = await deferred.promise;
		assert.strictEqual(result, 'big:10');
	});

	test('cancel rejects the promise', async () => {
		const emitter = new Emitter<string>();
		const deferred = promisifyDeferred(emitter.event);

		deferred.cancel();

		await assert.rejects(async () => deferred.promise);
		assert.strictEqual(deferred.pending, false);
	});
});

suite('weakEvent', () => {
	test('fires listener with correct thisArg', () => {
		const emitter = new Emitter<number>();
		const obj = { value: 0 };

		weakEvent(
			emitter.event,
			function (this: typeof obj, e: number) {
				this.value = e;
			},
			obj,
		);

		emitter.fire(42);
		assert.strictEqual(obj.value, 42);
	});

	test('dispose stops event delivery', () => {
		const emitter = new Emitter<void>();
		const obj = { count: 0 };

		const d = weakEvent(
			emitter.event,
			function (this: typeof obj) {
				this.count++;
			},
			obj,
		);

		emitter.fire();
		assert.strictEqual(obj.count, 1);

		d.dispose();

		emitter.fire();
		assert.strictEqual(obj.count, 1);
	});

	test('disposes additional disposables on dispose', () => {
		const emitter = new Emitter<void>();
		const obj = { count: 0 };
		let extraDisposed = false;
		const extraDisposable = { dispose: () => (extraDisposed = true) };

		const d = weakEvent(
			emitter.event,
			function (this: typeof obj) {
				this.count++;
			},
			obj,
			[extraDisposable],
		);

		d.dispose();
		assert.strictEqual(extraDisposed, true);
	});
});
