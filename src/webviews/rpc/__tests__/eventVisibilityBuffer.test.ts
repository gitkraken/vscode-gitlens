import * as assert from 'assert';
import * as sinon from 'sinon';
import {
	bufferEventHandler,
	createRpcEvent,
	createRpcEventSubscription,
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

		test('should flush pending handlers on setVisible(true)', () => {
			const buffer = new EventVisibilityBuffer();
			const spy = sinon.spy();

			buffer.setVisible(false);
			buffer.addPending('event1', spy);
			assert.strictEqual(spy.callCount, 0);

			buffer.setVisible(true);
			assert.strictEqual(spy.callCount, 1);
		});

		test('should overwrite pending handler for the same key', () => {
			const buffer = new EventVisibilityBuffer();
			const spy1 = sinon.spy();
			const spy2 = sinon.spy();

			buffer.setVisible(false);
			buffer.addPending('event1', spy1);
			buffer.addPending('event1', spy2);

			buffer.setVisible(true);
			assert.strictEqual(spy1.callCount, 0, 'first handler should not fire');
			assert.strictEqual(spy2.callCount, 1, 'second (latest) handler should fire');
		});

		test('should flush multiple different-keyed handlers', () => {
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

		test('should allow handlers to re-add pending during flush without infinite loop', () => {
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
			assert.strictEqual(callCount, 1, 'only the original handler should fire in this flush');

			// Now flush again to invoke the re-added handler
			buffer.setVisible(false);
			buffer.setVisible(true);
			assert.strictEqual(callCount, 2);
		});

		test('should allow removePending to cancel a pending handler', () => {
			const buffer = new EventVisibilityBuffer();
			const spy = sinon.spy();

			buffer.setVisible(false);
			buffer.addPending('event1', spy);
			buffer.removePending('event1');

			buffer.setVisible(true);
			assert.strictEqual(spy.callCount, 0);
		});
	});

	suite('bufferEventHandler', () => {
		test('should return the original handler when buffer is undefined', () => {
			const handler = sinon.spy();
			const result = bufferEventHandler(undefined, 'key', handler, 'save-last');
			assert.strictEqual(result, handler, 'should return the same function reference');
		});

		test('should invoke handler immediately when visible (save-last)', () => {
			const buffer = new EventVisibilityBuffer();
			const handler = sinon.spy();
			const buffered = bufferEventHandler(buffer, 'key', handler, 'save-last');

			buffered('data1');
			assert.strictEqual(handler.callCount, 1);
			assert.strictEqual(handler.firstCall.args[0], 'data1');
		});

		test('should invoke handler immediately when visible (signal)', () => {
			const buffer = new EventVisibilityBuffer();
			const handler = sinon.spy();
			const buffered = bufferEventHandler(buffer, 'key', handler, 'signal', undefined);

			buffered('data1');
			assert.strictEqual(handler.callCount, 1);
			assert.strictEqual(handler.firstCall.args[0], 'data1');
		});

		test('should buffer and replay latest data in save-last mode', () => {
			const buffer = new EventVisibilityBuffer();
			const handler = sinon.spy();
			const buffered = bufferEventHandler(buffer, 'key', handler, 'save-last');

			buffer.setVisible(false);
			buffered('data1');
			buffered('data2');
			buffered('data3');
			assert.strictEqual(handler.callCount, 0, 'should not invoke while hidden');

			buffer.setVisible(true);
			assert.strictEqual(handler.callCount, 1, 'should invoke once on flush');
			assert.strictEqual(handler.firstCall.args[0], 'data3', 'should replay latest data');
		});

		test('should buffer and replay signalValue in signal mode', () => {
			const buffer = new EventVisibilityBuffer();
			const handler = sinon.spy();
			const buffered = bufferEventHandler<string>(buffer, 'key', handler, 'signal', 'refresh-signal');

			buffer.setVisible(false);
			buffered('actual-data');
			assert.strictEqual(handler.callCount, 0);

			buffer.setVisible(true);
			assert.strictEqual(handler.callCount, 1);
			assert.strictEqual(
				handler.firstCall.args[0],
				'refresh-signal',
				'should replay signal value, not actual data',
			);
		});

		test('should replay undefined as signalValue when not specified in signal mode', () => {
			const buffer = new EventVisibilityBuffer();
			const handler = sinon.spy();
			const buffered = bufferEventHandler(buffer, 'key', handler, 'signal');

			buffer.setVisible(false);
			buffered('actual-data');

			buffer.setVisible(true);
			assert.strictEqual(handler.callCount, 1);
			assert.strictEqual(handler.firstCall.args[0], undefined, 'should replay undefined');
		});
	});

	suite('createRpcEventSubscription', () => {
		test('should return a function (RpcEventSubscription<T>)', () => {
			const subscriber = createRpcEventSubscription<string>(undefined, 'key', 'save-last', handler => {
				handler('initial');
				return { dispose: () => {} };
			});
			assert.strictEqual(typeof subscriber, 'function');
		});

		test('should call subscribe with the handler and return unsubscribe', () => {
			const disposeSpy = sinon.spy();
			const subscriber = createRpcEventSubscription<string>(undefined, 'key', 'save-last', _handler => ({
				dispose: disposeSpy,
			}));

			const handler = sinon.spy();
			const unsubscribe = subscriber(handler) as () => void;

			assert.strictEqual(typeof unsubscribe, 'function');
			unsubscribe();
			assert.strictEqual(disposeSpy.callCount, 1);
		});

		test('should use buffered handler when buffer is provided', () => {
			const buffer = new EventVisibilityBuffer();
			const disposeSpy = sinon.spy();
			let capturedhandler: ((data: string) => void) | undefined;

			const subscriber = createRpcEventSubscription<string>(buffer, 'key', 'save-last', handler => {
				capturedhandler = handler;
				return { dispose: disposeSpy };
			});

			const handler = sinon.spy();
			subscriber(handler);

			// Fire while hidden — should buffer
			buffer.setVisible(false);
			capturedhandler!('hidden-data');
			assert.strictEqual(handler.callCount, 0);

			// Flush
			buffer.setVisible(true);
			assert.strictEqual(handler.callCount, 1);
			assert.strictEqual(handler.firstCall.args[0], 'hidden-data');
		});

		test('should replay buffered events for multiple subscribers using the same logical key', () => {
			const buffer = new EventVisibilityBuffer();
			const handlers: Array<(data: string) => void> = [];

			const subscriber = createRpcEventSubscription<string>(buffer, 'shared-key', 'save-last', handler => {
				handlers.push(handler);
				return { dispose: () => {} };
			});

			const handler1 = sinon.spy();
			const handler2 = sinon.spy();
			subscriber(handler1);
			subscriber(handler2);

			buffer.setVisible(false);
			handlers[0]('first-1');
			handlers[1]('second-1');
			handlers[0]('first-2');
			handlers[1]('second-2');

			buffer.setVisible(true);

			assert.strictEqual(handler1.callCount, 1);
			assert.strictEqual(handler1.firstCall.args[0], 'first-2');
			assert.strictEqual(handler2.callCount, 1);
			assert.strictEqual(handler2.firstCall.args[0], 'second-2');
		});

		test('should remove pending and dispose on unsubscribe', () => {
			const buffer = new EventVisibilityBuffer();
			const disposeSpy = sinon.spy();
			let capturedhandler: ((data: string) => void) | undefined;

			const subscriber = createRpcEventSubscription<string>(buffer, 'my-event', 'save-last', handler => {
				capturedhandler = handler;
				return { dispose: disposeSpy };
			});

			const handler = sinon.spy();
			const unsubscribe = subscriber(handler) as () => void;

			// Add a pending entry
			buffer.setVisible(false);
			capturedhandler!('data');

			// Unsubscribe should remove pending and dispose
			unsubscribe();
			assert.strictEqual(disposeSpy.callCount, 1);

			// Flushing should not invoke the handler (pending was removed)
			buffer.setVisible(true);
			assert.strictEqual(handler.callCount, 0);
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

		test('createRpcEventSubscription should track via tracker', () => {
			const tracker = new SubscriptionTracker();
			const disposeSpy = sinon.spy();

			const subscriber = createRpcEventSubscription<string>(
				undefined,
				'key',
				'save-last',
				_handler => ({ dispose: disposeSpy }),
				undefined,
				tracker,
			);

			const handler = sinon.spy();
			subscriber(handler);

			// Dispose tracker should clean up the subscription
			tracker.dispose();
			assert.strictEqual(disposeSpy.callCount, 1);
		});
	});

	suite('createRpcEvent', () => {
		test('should return subscriber and fire', () => {
			const event = createRpcEvent<string>('key', 'save-last');
			assert.strictEqual(typeof event.subscribe, 'function');
			assert.strictEqual(typeof event.fire, 'function');
		});

		test('fire should invoke all subscribed handlers', () => {
			const event = createRpcEvent<string>('key', 'save-last');
			const subscriber = event.subscribe();
			const cb1 = sinon.spy();
			const cb2 = sinon.spy();
			subscriber(cb1);
			subscriber(cb2);

			event.fire('hello');
			assert.strictEqual(cb1.callCount, 1);
			assert.strictEqual(cb1.firstCall.args[0], 'hello');
			assert.strictEqual(cb2.callCount, 1);
			assert.strictEqual(cb2.firstCall.args[0], 'hello');
		});

		test('fire should not invoke unsubscribed handlers', () => {
			const event = createRpcEvent<string>('key', 'save-last');
			const subscriber = event.subscribe();
			const cb = sinon.spy();
			const unsub = subscriber(cb) as () => void;

			unsub();
			event.fire('hello');
			assert.strictEqual(cb.callCount, 0);
		});

		test('should work with visibility buffer', () => {
			const buffer = new EventVisibilityBuffer();
			const event = createRpcEvent<string>('key', 'save-last');
			const subscriber = event.subscribe(buffer);
			const cb = sinon.spy();
			subscriber(cb);

			buffer.setVisible(false);
			event.fire('hidden-data');
			assert.strictEqual(cb.callCount, 0);

			buffer.setVisible(true);
			assert.strictEqual(cb.callCount, 1);
			assert.strictEqual(cb.firstCall.args[0], 'hidden-data');
		});

		test('should work with tracker', () => {
			const tracker = new SubscriptionTracker();
			const event = createRpcEvent<string>('key', 'save-last');
			const subscriber = event.subscribe(undefined, tracker);
			const cb = sinon.spy();
			subscriber(cb);

			event.fire('before-dispose');
			assert.strictEqual(cb.callCount, 1);

			tracker.dispose();
			event.fire('after-dispose');
			assert.strictEqual(cb.callCount, 1);
		});

		test('subscriber can be called with different tracker across reconnections', () => {
			const event = createRpcEvent<string>('key', 'save-last');
			const tracker1 = new SubscriptionTracker();
			const tracker2 = new SubscriptionTracker();

			const sub1 = event.subscribe(undefined, tracker1);
			const cb1 = sinon.spy();
			sub1(cb1);

			// Simulate reconnection: dispose old tracker, create new subscriber
			tracker1.dispose();

			const sub2 = event.subscribe(undefined, tracker2);
			const cb2 = sinon.spy();
			sub2(cb2);

			event.fire('data');
			assert.strictEqual(cb1.callCount, 0, 'cleaned up by tracker1.dispose()');
			assert.strictEqual(cb2.callCount, 1);
		});

		test('should replay signalValue in signal mode', () => {
			const buffer = new EventVisibilityBuffer();
			const event = createRpcEvent<undefined>('key', 'signal');
			const subscriber = event.subscribe(buffer);
			const cb = sinon.spy();
			subscriber(cb);

			buffer.setVisible(false);
			event.fire(undefined);
			assert.strictEqual(cb.callCount, 0);

			buffer.setVisible(true);
			assert.strictEqual(cb.callCount, 1);
			assert.strictEqual(cb.firstCall.args[0], undefined);
		});
	});
});
