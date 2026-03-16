import * as assert from 'assert';
import { entry, optimisticBatchFireAndForget } from '../rpc.js';

function createSignal<T>(initial: T): { get: () => T; set: (value: T) => void } {
	let value = initial;
	return {
		get: () => value,
		set: next => {
			value = next;
		},
	};
}

suite('rpc action helpers', () => {
	test('should not roll back over an intervening non-optimistic write', async () => {
		const signal = createSignal('before');

		optimisticBatchFireAndForget([entry(signal as any, 'optimistic')], Promise.reject(new Error('boom')));
		signal.set('event-update');

		await Promise.resolve();
		await Promise.resolve();

		assert.strictEqual(signal.get(), 'event-update');
	});

	test('should still roll back when the optimistic value is unchanged', async () => {
		const signal = createSignal('before');

		optimisticBatchFireAndForget([entry(signal as any, 'optimistic')], Promise.reject(new Error('boom')));

		await Promise.resolve();
		await Promise.resolve();

		assert.strictEqual(signal.get(), 'before');
	});
});
