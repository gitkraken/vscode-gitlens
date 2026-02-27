import * as assert from 'assert';
import { Signal } from 'signal-polyfill';
import { createRemoteSignalBridge } from '../remoteSignal.js';

suite('createRemoteSignalBridge Test Suite', () => {
	suite('before connect', () => {
		test('should return default value', () => {
			const bridge = createRemoteSignalBridge(0);

			assert.strictEqual(bridge.get(), 0);
		});

		test('should return default for complex types', () => {
			const defaultValue = { count: 0, name: 'test' };
			const bridge = createRemoteSignalBridge(defaultValue);

			assert.deepStrictEqual(bridge.get(), defaultValue);
		});
	});

	suite('after connect', () => {
		test('should return remote value', () => {
			const bridge = createRemoteSignalBridge(0);
			const remote = new Signal.State(42);

			bridge.connect(remote);

			assert.strictEqual(bridge.get(), 42, 'should read from remote after connect');
		});

		test('should track remote signal changes', () => {
			const bridge = createRemoteSignalBridge('default');
			const remote = new Signal.State('hello');

			bridge.connect(remote);
			assert.strictEqual(bridge.get(), 'hello');

			remote.set('world');
			assert.strictEqual(bridge.get(), 'world', 'should reflect updated remote value');
		});
	});

	suite('disconnect', () => {
		test('should capture last remote value on disconnect', () => {
			const bridge = createRemoteSignalBridge(0);
			const remote = new Signal.State(42);

			bridge.connect(remote);
			assert.strictEqual(bridge.get(), 42);

			bridge.disconnect();
			assert.strictEqual(bridge.get(), 42, 'should retain last remote value after disconnect');
		});

		test('should not be affected by remote changes after disconnect', () => {
			const bridge = createRemoteSignalBridge(0);
			const remote = new Signal.State(42);

			bridge.connect(remote);
			bridge.disconnect();

			remote.set(999);
			assert.strictEqual(bridge.get(), 42, 'should not track remote after disconnect');
		});

		test('should return default value when disconnecting without prior connect', () => {
			const bridge = createRemoteSignalBridge('default');

			bridge.disconnect();

			assert.strictEqual(bridge.get(), 'default', 'disconnect without connect should be safe');
		});
	});

	suite('reconnect', () => {
		test('should switch to new remote on reconnect', () => {
			const bridge = createRemoteSignalBridge(0);
			const remote1 = new Signal.State(10);
			const remote2 = new Signal.State(20);

			bridge.connect(remote1);
			assert.strictEqual(bridge.get(), 10);

			bridge.disconnect();
			bridge.connect(remote2);
			assert.strictEqual(bridge.get(), 20, 'should read from new remote');
		});

		test('should replace remote without disconnect', () => {
			const bridge = createRemoteSignalBridge(0);
			const remote1 = new Signal.State(10);
			const remote2 = new Signal.State(20);

			bridge.connect(remote1);
			bridge.connect(remote2);

			assert.strictEqual(bridge.get(), 20, 'should read from latest connected remote');
		});
	});
});
