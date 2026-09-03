import * as assert from 'assert';
import { deflateRaw } from '@env/compression.js';
import type { RpcMessageWrapper } from '../constants.js';
import {
	decodeRpcPayload,
	encodeRpcPayload,
	inflateRpcPayload,
	isRpcMessage,
	rehydrateBinaryRpcPayload,
	RPC_NAMESPACE,
} from '../constants.js';

suite('RPC Constants Test Suite', () => {
	suite('isRpcMessage', () => {
		test('should return true for a valid RPC message', () => {
			const msg: RpcMessageWrapper = {
				[RPC_NAMESPACE]: true,
				payload: { method: 'test', args: [] },
			};
			assert.strictEqual(isRpcMessage(msg), true);
		});

		test('should return true for RPC message with any payload', () => {
			const msg: RpcMessageWrapper = {
				[RPC_NAMESPACE]: true,
				payload: null,
			};
			assert.strictEqual(isRpcMessage(msg), true);
		});

		test('should return false for null', () => {
			assert.strictEqual(isRpcMessage(null), false);
		});

		test('should return false for undefined', () => {
			assert.strictEqual(isRpcMessage(undefined), false);
		});

		test('should return false for a string', () => {
			assert.strictEqual(isRpcMessage('hello'), false);
		});

		test('should return false for a number', () => {
			assert.strictEqual(isRpcMessage(42), false);
		});

		test('should return false for a plain object without namespace key', () => {
			assert.strictEqual(isRpcMessage({ method: 'test', timestamp: 123 }), false);
		});

		test('should return false for an object with namespace key set to false', () => {
			assert.strictEqual(isRpcMessage({ [RPC_NAMESPACE]: false, payload: {} }), false);
		});

		test('should return false for an object with namespace key set to a truthy non-true value', () => {
			assert.strictEqual(isRpcMessage({ [RPC_NAMESPACE]: 1, payload: {} }), false);
		});

		test('should return false for a standard IPC message', () => {
			const ipcMessage = {
				id: 'abc123',
				method: 'webview/ready',
				params: {},
				completionId: undefined,
			};
			assert.strictEqual(isRpcMessage(ipcMessage), false);
		});

		test('should return true regardless of extra properties', () => {
			const msg = {
				[RPC_NAMESPACE]: true,
				payload: {},
				extra: 'ignored',
			};
			assert.strictEqual(isRpcMessage(msg), true);
		});
	});

	suite('deflateRaw / inflateRpcPayload', () => {
		test('round-trips a multi-KB JSON payload through Uint8Array', async () => {
			const original = Array.from({ length: 300 }, (_, i) => ({
				id: i,
				name: `item-${i}`,
				tags: ['a', 'b', 'c'],
				active: i % 2 === 0,
			}));

			const encoded = new TextEncoder().encode(JSON.stringify(original));
			const deflated = deflateRaw(encoded);
			assert.ok(deflated != null);

			const inflated = await inflateRpcPayload(deflated);
			assert.deepStrictEqual(inflated, original);
		});

		test('round-trips through an ArrayBuffer', async () => {
			const original = Array.from({ length: 300 }, (_, i) => ({ id: i, value: `value-${i}` }));

			const encoded = new TextEncoder().encode(JSON.stringify(original));
			const deflated = deflateRaw(encoded);
			assert.ok(deflated != null);

			const buffer = deflated.buffer.slice(
				deflated.byteOffset,
				deflated.byteOffset + deflated.byteLength,
			) as ArrayBuffer;
			const inflated = await inflateRpcPayload(buffer);
			assert.deepStrictEqual(inflated, original);
		});
	});

	suite('rehydrateBinaryRpcPayload', () => {
		test('passes a real Uint8Array through unchanged, ignoring byteLength', () => {
			const payload = new Uint8Array([1, 2, 3]);
			assert.strictEqual(rehydrateBinaryRpcPayload(payload, undefined), payload);
			assert.strictEqual(rehydrateBinaryRpcPayload(payload, 999), payload);
		});

		test('passes a real ArrayBuffer through unchanged, ignoring byteLength', () => {
			const payload = new Uint8Array([1, 2, 3]).buffer;
			assert.strictEqual(rehydrateBinaryRpcPayload(payload, undefined), payload);
			assert.strictEqual(rehydrateBinaryRpcPayload(payload, 999), payload);
		});

		test('rehydrates a JSON-round-tripped numeric-keyed object back into a Uint8Array', () => {
			const encoded = encodeRpcPayload({ a: 1, b: 'test' });
			const mangled = JSON.parse(JSON.stringify(encoded)) as unknown;

			const rehydrated = rehydrateBinaryRpcPayload(mangled, encoded.byteLength);
			assert.ok(rehydrated instanceof Uint8Array);
			assert.deepStrictEqual(decodeRpcPayload(rehydrated), { a: 1, b: 'test' });
		});

		test('returns undefined for a mangled payload with a missing byteLength', () => {
			const encoded = encodeRpcPayload({ a: 1 });
			const mangled = JSON.parse(JSON.stringify(encoded)) as unknown;

			assert.strictEqual(rehydrateBinaryRpcPayload(mangled, undefined), undefined);
		});

		test('returns undefined for a non-object payload regardless of byteLength', () => {
			assert.strictEqual(rehydrateBinaryRpcPayload('hello', 5), undefined);
			assert.strictEqual(rehydrateBinaryRpcPayload(42, 5), undefined);
			assert.strictEqual(rehydrateBinaryRpcPayload(null, 5), undefined);
			assert.strictEqual(rehydrateBinaryRpcPayload(undefined, 5), undefined);
		});

		test('returns an empty Uint8Array for an empty mangled object with byteLength 0', () => {
			const mangled = JSON.parse(JSON.stringify(new Uint8Array(0))) as unknown;

			const rehydrated = rehydrateBinaryRpcPayload(mangled, 0);
			assert.ok(rehydrated instanceof Uint8Array);
			assert.strictEqual(rehydrated.length, 0);

			const rehydratedEmptyObject = rehydrateBinaryRpcPayload({}, 0);
			assert.ok(rehydratedEmptyObject instanceof Uint8Array);
			assert.strictEqual(rehydratedEmptyObject.length, 0);
		});
	});
});
