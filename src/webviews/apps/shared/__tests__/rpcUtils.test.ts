import * as assert from 'assert';
import { subscribeAll } from '../events/subscriptions.js';

suite('subscribeAll Test Suite', () => {
	test('should call all subscription closures and return a combined unsubscribe', async () => {
		const unsub1 = { called: false };
		const unsub2 = { called: false };

		const unsubscribe = await subscribeAll([
			() =>
				Promise.resolve(() => {
					unsub1.called = true;
				}),
			() =>
				Promise.resolve(() => {
					unsub2.called = true;
				}),
		]);

		assert.strictEqual(unsub1.called, false);
		assert.strictEqual(unsub2.called, false);

		unsubscribe();

		assert.strictEqual(unsub1.called, true, 'first unsubscriber should be called');
		assert.strictEqual(unsub2.called, true, 'second unsubscriber should be called');
	});

	test('should handle partial subscription failure gracefully', async () => {
		const unsub1 = { called: false };
		const unsub3 = { called: false };

		const unsubscribe = await subscribeAll([
			() =>
				Promise.resolve(() => {
					unsub1.called = true;
				}),
			() => Promise.reject(new Error('subscription setup failed')),
			() =>
				Promise.resolve(() => {
					unsub3.called = true;
				}),
		]);

		// The failed subscription should not prevent others from working
		unsubscribe();

		assert.strictEqual(unsub1.called, true, 'first unsubscriber should be called');
		assert.strictEqual(unsub3.called, true, 'third unsubscriber should be called');
	});

	test('should continue unsubscribing even if one unsubscriber throws', async () => {
		const unsub1 = { called: false };
		const unsub3 = { called: false };

		const unsubscribe = await subscribeAll([
			() =>
				Promise.resolve(() => {
					unsub1.called = true;
				}),
			() =>
				Promise.resolve(() => {
					throw new Error('unsubscribe failed');
				}),
			() =>
				Promise.resolve(() => {
					unsub3.called = true;
				}),
		]);

		// Should not throw even though the second unsubscriber throws
		unsubscribe();

		assert.strictEqual(unsub1.called, true, 'first unsubscriber should be called');
		assert.strictEqual(unsub3.called, true, 'third unsubscriber should be called');
	});

	test('should handle empty subscription list', async () => {
		const unsubscribe = await subscribeAll([]);

		// Should not throw
		unsubscribe();
	});

	test('should ignore non-function fulfilled values', async () => {
		const unsub1 = { called: false };

		const unsubscribe = await subscribeAll([
			() =>
				Promise.resolve(() => {
					unsub1.called = true;
				}),
			// Simulates a subscription that resolves with a non-function (e.g., undefined)
			() => Promise.resolve(undefined as any),
		]);

		unsubscribe();

		assert.strictEqual(unsub1.called, true, 'valid unsubscriber should be called');
	});
});
