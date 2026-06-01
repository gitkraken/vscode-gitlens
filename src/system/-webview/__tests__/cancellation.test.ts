import * as assert from 'node:assert';
import type { CancellationTokenSource } from 'vscode';
import { fromAbortSignal } from '../cancellation.js';

suite('cancellation', () => {
	suite('fromAbortSignal — registry tracking', () => {
		test('adds the created source to the registry and removes it on dispose', () => {
			const registry = new Set<CancellationTokenSource>();
			const controller = new AbortController();

			const { dispose } = fromAbortSignal(controller.signal, registry);
			assert.strictEqual(registry.size, 1, 'source registered while in flight');

			dispose();
			assert.strictEqual(registry.size, 0, 'source removed on dispose');
		});

		test('a registry-tracked source can be cancelled externally (teardown), cancelling its token', () => {
			const registry = new Set<CancellationTokenSource>();
			const controller = new AbortController();

			const { token } = fromAbortSignal(controller.signal, registry);
			assert.strictEqual(token?.isCancellationRequested, false);

			// Simulate a host teardown cancelling everything still in flight.
			for (const source of registry) {
				source.cancel();
			}
			assert.strictEqual(token?.isCancellationRequested, true, 'token cancelled via the registry');
		});

		test('aborting the signal cancels the token', () => {
			const controller = new AbortController();
			const { token } = fromAbortSignal(controller.signal);
			assert.strictEqual(token?.isCancellationRequested, false);

			controller.abort();
			assert.strictEqual(token?.isCancellationRequested, true);
		});

		test('already-aborted signal yields an already-cancelled token and registers nothing to leak', () => {
			const registry = new Set<CancellationTokenSource>();
			const controller = new AbortController();
			controller.abort();

			const { token, dispose } = fromAbortSignal(controller.signal, registry);
			assert.strictEqual(token?.isCancellationRequested, true);
			assert.strictEqual(registry.size, 1);

			dispose();
			assert.strictEqual(registry.size, 0);
		});

		test('undefined signal registers nothing', () => {
			const registry = new Set<CancellationTokenSource>();
			const { token } = fromAbortSignal(undefined, registry);
			assert.strictEqual(token, undefined);
			assert.strictEqual(registry.size, 0);
		});
	});
});
