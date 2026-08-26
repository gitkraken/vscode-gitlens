import * as assert from 'assert';
import { deflateRaw } from '@env/compression.js';
import type { RpcMessageWrapper } from '../../../rpc/constants.js';
import { encodeRpcPayload, RPC_NAMESPACE } from '../../../rpc/constants.js';
import { createOrderedDispatcher } from '../webviewEndpoint.js';

/** Builds an uncompressed RPC wrapper for a message. */
function wrapUncompressed(message: unknown): RpcMessageWrapper {
	return { [RPC_NAMESPACE]: true, payload: encodeRpcPayload(message) };
}

/** Builds a `deflate-raw` compressed RPC wrapper for a message. */
function wrapCompressed(message: unknown): RpcMessageWrapper {
	const encoded = encodeRpcPayload(message);
	const deflated = deflateRaw(encoded);
	assert.ok(deflated != null);

	return { [RPC_NAMESPACE]: true, payload: deflated, compressed: 'deflate-raw' };
}

/** Yields to the microtask/macrotask queue a few times so the dispatcher's chain can drain. */
async function drain(): Promise<void> {
	for (let i = 0; i < 5; i++) {
		await new Promise<void>(resolve => setImmediate(resolve));
	}
}

// oxlint-disable-next-line typescript/consistent-type-assertions
const fakeEvent = {} as MessageEvent;

suite('createOrderedDispatcher Test Suite', () => {
	test('delivers an uncompressed message synchronously', () => {
		const deliveries: unknown[] = [];
		const dispatcher = createOrderedDispatcher(data => deliveries.push(data));

		dispatcher.dispatch(wrapUncompressed({ hello: 'world' }), fakeEvent);

		// Populated immediately, before any await — no promise hop for the common case.
		assert.strictEqual(deliveries.length, 1);
		assert.deepStrictEqual(deliveries[0], { hello: 'world' });

		dispatcher.dispose();
	});

	test('delivers a compressed then an uncompressed message in order', async () => {
		const deliveries: unknown[] = [];
		const dispatcher = createOrderedDispatcher(data => deliveries.push(data));

		dispatcher.dispatch(wrapCompressed({ id: 1 }), fakeEvent);
		dispatcher.dispatch(wrapUncompressed({ id: 2 }), fakeEvent);

		await drain();

		assert.deepStrictEqual(deliveries, [{ id: 1 }, { id: 2 }]);

		dispatcher.dispose();
	});

	test('dispose() suppresses delivery of an already-dispatched compressed message', async () => {
		const deliveries: unknown[] = [];
		const dispatcher = createOrderedDispatcher(data => deliveries.push(data));

		dispatcher.dispatch(wrapCompressed({ id: 1 }), fakeEvent);
		dispatcher.dispose();

		await drain();

		assert.strictEqual(deliveries.length, 0);
	});

	test('drops a corrupt compressed message without stalling later messages', async () => {
		const deliveries: unknown[] = [];
		const dispatcher = createOrderedDispatcher(data => deliveries.push(data));

		const corrupt: RpcMessageWrapper = {
			[RPC_NAMESPACE]: true,
			payload: new Uint8Array([1, 2, 3]),
			compressed: 'deflate-raw',
		};
		dispatcher.dispatch(corrupt, fakeEvent);
		dispatcher.dispatch(wrapUncompressed({ id: 'still delivered' }), fakeEvent);

		await drain();

		assert.deepStrictEqual(deliveries, [{ id: 'still delivered' }]);

		dispatcher.dispose();
	});
});
