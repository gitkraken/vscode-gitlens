import * as assert from 'assert';
import * as sinon from 'sinon';
import {
	createBufferedCallback,
	createCallbackMapSubscription,
	createEventSubscription,
	EventVisibilityBuffer,
	SubscriptionTracker,
} from '../eventVisibilityBuffer.js';

suite('EventVisibilityBuffer Test Suite', () => {
	suite('EventVisibilityBuffer', () => {
		test('should start visible', () => {
			const buffer = new EventVisibilityBuffer();
			assert.strictEqual(buffer.visible, true);
		});

		test('should become hidden when setVisible(false)', () => {
			const buffer = new EventVisibilityBuffer();
			buffer.setVisible(false);
			assert.strictEqual(buffer.visible, false);
		});

		test('should become visible when setVisible(true)', () => {
			const buffer = new EventVisibilityBuffer();
			buffer.setVisible(false);
			buffer.setVisible(true);
			assert.strictEqual(buffer.visible, true);
		});

		test('should flush pending callbacks on setVisible(true)', () => {
			const buffer = new EventVisibilityBuffer();
			const spy = sinon.spy();

			buffer.setVisible(false);
			buffer.addPending('event1', spy);
			assert.strictEqual(spy.callCount, 0);

			buffer.setVisible(true);
			assert.strictEqual(spy.callCount, 1);
		});

		test('should overwrite pending callback for the same key', () => {
			const buffer = new EventVisibilityBuffer();
			const spy1 = sinon.spy();
			const spy2 = sinon.spy();

			buffer.setVisible(false);
			buffer.addPending('event1', spy1);
			buffer.addPending('event1', spy2);

			buffer.setVisible(true);
			assert.strictEqual(spy1.callCount, 0, 'first callback should not fire');
			assert.strictEqual(spy2.callCount, 1, 'second (latest) callback should fire');
		});

		test('should flush multiple different-keyed callbacks', () => {
			const buffer = new EventVisibilityBuffer();
			const spy1 = sinon.spy();
			const spy2 = sinon.spy();

			buffer.setVisible(false);
			buffer.addPending('event1', spy1);
			buffer.addPending('event2', spy2);

			buffer.setVisible(true);
			assert.strictEqual(spy1.callCount, 1);
			assert.strictEqual(spy2.callCount, 1);
		});

		test('should not invoke anything when flushing with no pending', () => {
			const buffer = new EventVisibilityBuffer();
			// Should not throw
			buffer.setVisible(false);
			buffer.setVisible(true);
		});

		test('should clear pending map after flush', () => {
			const buffer = new EventVisibilityBuffer();
			const spy = sinon.spy();

			buffer.setVisible(false);
			buffer.addPending('event1', spy);
			buffer.setVisible(true);
			assert.strictEqual(spy.callCount, 1);

			// Second flush should not re-invoke
			buffer.setVisible(false);
			buffer.setVisible(true);
			assert.strictEqual(spy.callCount, 1);
		});

		test('should allow callbacks to re-add pending during flush without infinite loop', () => {
			const buffer = new EventVisibilityBuffer();
			let callCount = 0;

			buffer.setVisible(false);
			buffer.addPending('event1', () => {
				callCount++;
				// Re-add during flush — should NOT be invoked in this flush cycle
				buffer.addPending('event1', () => {
					callCount++;
				});
			});

			buffer.setVisible(true);
			assert.strictEqual(callCount, 1, 'only the original callback should fire in this flush');

			// Now flush again to invoke the re-added callback
			buffer.setVisible(false);
			buffer.setVisible(true);
			assert.strictEqual(callCount, 2);
		});

		test('should allow removePending to cancel a pending callback', () => {
			const buffer = new EventVisibilityBuffer();
			const spy = sinon.spy();

			buffer.setVisible(false);
			buffer.addPending('event1', spy);
			buffer.removePending('event1');

			buffer.setVisible(true);
			assert.strictEqual(spy.callCount, 0);
		});
	});

	suite('createBufferedCallback', () => {
		test('should return the original callback when buffer is undefined', () => {
			const callback = sinon.spy();
			const result = createBufferedCallback(undefined, 'key', callback, 'save-last');
			assert.strictEqual(result, callback, 'should return the same function reference');
		});

		test('should invoke callback immediately when visible (save-last)', () => {
			const buffer = new EventVisibilityBuffer();
			const callback = sinon.spy();
			const buffered = createBufferedCallback(buffer, 'key', callback, 'save-last');

			buffered('data1');
			assert.strictEqual(callback.callCount, 1);
			assert.strictEqual(callback.firstCall.args[0], 'data1');
		});

		test('should invoke callback immediately when visible (signal)', () => {
			const buffer = new EventVisibilityBuffer();
			const callback = sinon.spy();
			const buffered = createBufferedCallback(buffer, 'key', callback, 'signal', undefined);

			buffered('data1');
			assert.strictEqual(callback.callCount, 1);
			assert.strictEqual(callback.firstCall.args[0], 'data1');
		});

		test('should buffer and replay latest data in save-last mode', () => {
			const buffer = new EventVisibilityBuffer();
			const callback = sinon.spy();
			const buffered = createBufferedCallback(buffer, 'key', callback, 'save-last');

			buffer.setVisible(false);
			buffered('data1');
			buffered('data2');
			buffered('data3');
			assert.strictEqual(callback.callCount, 0, 'should not invoke while hidden');

			buffer.setVisible(true);
			assert.strictEqual(callback.callCount, 1, 'should invoke once on flush');
			assert.strictEqual(callback.firstCall.args[0], 'data3', 'should replay latest data');
		});

		test('should buffer and replay signalValue in signal mode', () => {
			const buffer = new EventVisibilityBuffer();
			const callback = sinon.spy();
			const buffered = createBufferedCallback<string>(buffer, 'key', callback, 'signal', 'refresh-signal');

			buffer.setVisible(false);
			buffered('actual-data');
			assert.strictEqual(callback.callCount, 0);

			buffer.setVisible(true);
			assert.strictEqual(callback.callCount, 1);
			assert.strictEqual(
				callback.firstCall.args[0],
				'refresh-signal',
				'should replay signal value, not actual data',
			);
		});

		test('should replay undefined as signalValue when not specified in signal mode', () => {
			const buffer = new EventVisibilityBuffer();
			const callback = sinon.spy();
			const buffered = createBufferedCallback(buffer, 'key', callback, 'signal');

			buffer.setVisible(false);
			buffered('actual-data');

			buffer.setVisible(true);
			assert.strictEqual(callback.callCount, 1);
			assert.strictEqual(callback.firstCall.args[0], undefined, 'should replay undefined');
		});
	});

	suite('createEventSubscription', () => {
		test('should return a function (EventSubscriber)', () => {
			const subscriber = createEventSubscription<string>(undefined, 'key', 'save-last', callback => {
				callback('initial');
				return { dispose: () => {} };
			});
			assert.strictEqual(typeof subscriber, 'function');
		});

		test('should call subscribe with the callback and return unsubscribe', () => {
			const disposeSpy = sinon.spy();
			const subscriber = createEventSubscription<string>(undefined, 'key', 'save-last', _callback => ({
				dispose: disposeSpy,
			}));

			const callback = sinon.spy();
			const unsubscribe = subscriber(callback);

			assert.strictEqual(typeof unsubscribe, 'function');
			unsubscribe();
			assert.strictEqual(disposeSpy.callCount, 1);
		});

		test('should use buffered callback when buffer is provided', () => {
			const buffer = new EventVisibilityBuffer();
			const disposeSpy = sinon.spy();
			let capturedCallback: ((data: string) => void) | undefined;

			const subscriber = createEventSubscription<string>(buffer, 'key', 'save-last', callback => {
				capturedCallback = callback;
				return { dispose: disposeSpy };
			});

			const callback = sinon.spy();
			subscriber(callback);

			// Fire while hidden — should buffer
			buffer.setVisible(false);
			capturedCallback!('hidden-data');
			assert.strictEqual(callback.callCount, 0);

			// Flush
			buffer.setVisible(true);
			assert.strictEqual(callback.callCount, 1);
			assert.strictEqual(callback.firstCall.args[0], 'hidden-data');
		});

		test('should replay buffered events for multiple subscribers using the same logical key', () => {
			const buffer = new EventVisibilityBuffer();
			const callbacks: Array<(data: string) => void> = [];

			const subscriber = createEventSubscription<string>(buffer, 'shared-key', 'save-last', callback => {
				callbacks.push(callback);
				return { dispose: () => {} };
			});

			const callback1 = sinon.spy();
			const callback2 = sinon.spy();
			subscriber(callback1);
			subscriber(callback2);

			buffer.setVisible(false);
			callbacks[0]('first-1');
			callbacks[1]('second-1');
			callbacks[0]('first-2');
			callbacks[1]('second-2');

			buffer.setVisible(true);

			assert.strictEqual(callback1.callCount, 1);
			assert.strictEqual(callback1.firstCall.args[0], 'first-2');
			assert.strictEqual(callback2.callCount, 1);
			assert.strictEqual(callback2.firstCall.args[0], 'second-2');
		});

		test('should remove pending and dispose on unsubscribe', () => {
			const buffer = new EventVisibilityBuffer();
			const disposeSpy = sinon.spy();
			let capturedCallback: ((data: string) => void) | undefined;

			const subscriber = createEventSubscription<string>(buffer, 'my-event', 'save-last', callback => {
				capturedCallback = callback;
				return { dispose: disposeSpy };
			});

			const callback = sinon.spy();
			const unsubscribe = subscriber(callback);

			// Add a pending entry
			buffer.setVisible(false);
			capturedCallback!('data');

			// Unsubscribe should remove pending and dispose
			unsubscribe();
			assert.strictEqual(disposeSpy.callCount, 1);

			// Flushing should not invoke the callback (pending was removed)
			buffer.setVisible(true);
			assert.strictEqual(callback.callCount, 0);
		});
	});

	suite('createCallbackMapSubscription', () => {
		test('should return a function (EventSubscriber)', () => {
			const callbackMap = new Map<symbol, (data: string) => void>();
			const subscriber = createCallbackMapSubscription<string>(undefined, 'key', 'save-last', callbackMap);
			assert.strictEqual(typeof subscriber, 'function');
		});

		test('should add entry to callback map on subscribe', () => {
			const callbackMap = new Map<symbol, (data: string) => void>();
			const subscriber = createCallbackMapSubscription<string>(undefined, 'key', 'save-last', callbackMap);

			const callback = sinon.spy();
			subscriber(callback);

			assert.strictEqual(callbackMap.size, 1);
		});

		test('should remove entry from callback map on unsubscribe', () => {
			const callbackMap = new Map<symbol, (data: string) => void>();
			const subscriber = createCallbackMapSubscription<string>(undefined, 'key', 'save-last', callbackMap);

			const callback = sinon.spy();
			const unsubscribe = subscriber(callback);

			assert.strictEqual(callbackMap.size, 1);
			unsubscribe();
			assert.strictEqual(callbackMap.size, 0);
		});

		test('should use buffered callback in the map', () => {
			const buffer = new EventVisibilityBuffer();
			const callbackMap = new Map<symbol, (data: string) => void>();
			const subscriber = createCallbackMapSubscription<string>(buffer, 'key', 'save-last', callbackMap);

			const callback = sinon.spy();
			subscriber(callback);

			// Simulate provider firing the event while hidden
			buffer.setVisible(false);
			for (const cb of callbackMap.values()) {
				cb('hidden-data');
			}
			assert.strictEqual(callback.callCount, 0);

			// Flush
			buffer.setVisible(true);
			assert.strictEqual(callback.callCount, 1);
			assert.strictEqual(callback.firstCall.args[0], 'hidden-data');
		});

		test('should replay buffered events for multiple callback-map subscribers using the same logical key', () => {
			const buffer = new EventVisibilityBuffer();
			const callbackMap = new Map<symbol, (data: string) => void>();
			const subscriber = createCallbackMapSubscription<string>(buffer, 'shared-key', 'save-last', callbackMap);

			const callback1 = sinon.spy();
			const callback2 = sinon.spy();
			subscriber(callback1);
			subscriber(callback2);

			buffer.setVisible(false);
			const callbacks = [...callbackMap.values()];
			callbacks[0]('first-1');
			callbacks[1]('second-1');
			callbacks[0]('first-2');
			callbacks[1]('second-2');

			buffer.setVisible(true);

			assert.strictEqual(callback1.callCount, 1);
			assert.strictEqual(callback1.firstCall.args[0], 'first-2');
			assert.strictEqual(callback2.callCount, 1);
			assert.strictEqual(callback2.firstCall.args[0], 'second-2');
		});

		test('should remove pending and map entry on unsubscribe', () => {
			const buffer = new EventVisibilityBuffer();
			const callbackMap = new Map<symbol, (data: string) => void>();
			const subscriber = createCallbackMapSubscription<string>(buffer, 'my-event', 'save-last', callbackMap);

			const callback = sinon.spy();
			const unsubscribe = subscriber(callback);

			// Add a pending entry
			buffer.setVisible(false);
			for (const cb of callbackMap.values()) {
				cb('data');
			}

			// Unsubscribe should remove both map entry and pending
			unsubscribe();
			assert.strictEqual(callbackMap.size, 0);

			// Flushing should not invoke the callback
			buffer.setVisible(true);
			assert.strictEqual(callback.callCount, 0);
		});
	});

	suite('SubscriptionTracker', () => {
		test('should track an unsubscribe and return a wrapped version', () => {
			const tracker = new SubscriptionTracker();
			const innerUnsub = sinon.spy();
			const tracked = tracker.track(innerUnsub);

			assert.notStrictEqual(tracked, innerUnsub, 'should return a new function');
			assert.strictEqual(typeof tracked, 'function');
		});

		test('should call the inner unsubscribe when the tracked function is called', () => {
			const tracker = new SubscriptionTracker();
			const innerUnsub = sinon.spy();
			const tracked = tracker.track(innerUnsub);

			tracked();
			assert.strictEqual(innerUnsub.callCount, 1);
		});

		test('should remove from tracker when the tracked function is called', () => {
			const tracker = new SubscriptionTracker();
			const innerUnsub = sinon.spy();
			const tracked = tracker.track(innerUnsub);

			tracked();
			assert.strictEqual(innerUnsub.callCount, 1);

			// Disposing the tracker should NOT call the already-unsubscribed function again
			tracker.dispose();
			assert.strictEqual(innerUnsub.callCount, 1);
		});

		test('should call all tracked unsubscribes on dispose', () => {
			const tracker = new SubscriptionTracker();
			const unsub1 = sinon.spy();
			const unsub2 = sinon.spy();
			const unsub3 = sinon.spy();

			tracker.track(unsub1);
			tracker.track(unsub2);
			tracker.track(unsub3);

			tracker.dispose();
			assert.strictEqual(unsub1.callCount, 1);
			assert.strictEqual(unsub2.callCount, 1);
			assert.strictEqual(unsub3.callCount, 1);
		});

		test('should clear the tracker after dispose', () => {
			const tracker = new SubscriptionTracker();
			const unsub = sinon.spy();
			tracker.track(unsub);

			tracker.dispose();
			assert.strictEqual(unsub.callCount, 1);

			// Second dispose should NOT call unsub again
			tracker.dispose();
			assert.strictEqual(unsub.callCount, 1);
		});

		test('should not dispose already-unsubscribed entries', () => {
			const tracker = new SubscriptionTracker();
			const unsub1 = sinon.spy();
			const unsub2 = sinon.spy();

			const tracked1 = tracker.track(unsub1);
			tracker.track(unsub2);

			// Manually unsubscribe the first
			tracked1();
			assert.strictEqual(unsub1.callCount, 1);

			// Dispose should only call the remaining tracked one
			tracker.dispose();
			assert.strictEqual(unsub1.callCount, 1, 'already-unsubscribed should not be called again');
			assert.strictEqual(unsub2.callCount, 1, 'remaining tracked should be called');
		});

		test('createEventSubscription should track via tracker', () => {
			const tracker = new SubscriptionTracker();
			const disposeSpy = sinon.spy();

			const subscriber = createEventSubscription<string>(
				undefined,
				'key',
				'save-last',
				_callback => ({ dispose: disposeSpy }),
				undefined,
				tracker,
			);

			const callback = sinon.spy();
			subscriber(callback);

			// Dispose tracker should clean up the subscription
			tracker.dispose();
			assert.strictEqual(disposeSpy.callCount, 1);
		});

		test('createCallbackMapSubscription should track via tracker', () => {
			const tracker = new SubscriptionTracker();
			const callbackMap = new Map<symbol, (data: string) => void>();

			const subscriber = createCallbackMapSubscription<string>(
				undefined,
				'key',
				'save-last',
				callbackMap,
				undefined,
				tracker,
			);

			const callback = sinon.spy();
			subscriber(callback);
			assert.strictEqual(callbackMap.size, 1);

			// Dispose tracker should clean up the callback map entry
			tracker.dispose();
			assert.strictEqual(callbackMap.size, 0);
		});
	});
});
