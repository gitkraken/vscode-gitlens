import * as assert from 'assert';
import type { RpcMessageWrapper } from '../constants.js';
import { isRpcMessage, RPC_NAMESPACE } from '../constants.js';

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
});
