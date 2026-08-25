import * as assert from 'assert';
import * as sinon from 'sinon';
import { Emitter } from '../../apps/shared/events.js';
import type { EventRegistration } from '../eventVisibilityBuffer.js';
import {
	bufferEventHandler,
	createRpcEvent,
	createRpcEventSubscription,
	EventVisibilityBuffer,
	SubscriptionTracker,
	trackRpcRegistration,
} from '../eventVisibilityBuffer.js';
import type { Unsubscribe } from '../services/types.js';

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
		test('should call the handler when buffer is undefined', () => {
			const handler = sinon.spy();
			const result = bufferEventHandler(undefined, 'key', handler, 'save-last');
			// Notify-wrapped (see toEventNotifier): a local (non-proxy) handler falls back to a plain
			// synchronous call, so the wrapper is a new function — identity is no longer preserved.
			result('data1');
			assert.strictEqual(handler.callCount, 1);
			assert.strictEqual(handler.firstCall.args[0], 'data1');
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

		test('two concurrent subscribers both receive (same generation, no supersede)', () => {
			const emitter = new Emitter<number>();
			const onThing = createRpcEventSubscription<number>(undefined, 'thing', 'save-last', b => emitter.event(b));
			const a: number[] = [];
			const b: number[] = [];

			onThing(n => a.push(n));
			onThing(n => b.push(n));
			emitter.fire(1);

			assert.deepStrictEqual({ a: a, b: b }, { a: [1], b: [1] }, 'both concurrent subscribers must receive');
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

		test('should bump epoch on reset and dispose so late async registrations are detectable', () => {
			const tracker = new SubscriptionTracker();
			// The async-subscription ordering this guards: capture epoch → await resource acquisition →
			// a reconnect reset()s the tracker mid-flight → the acquisition resolves. The epoch mismatch
			// is what tells the subscription its generation was superseded (see
			// `RepositoryRpcService.onRepositoryOrWorktreeChanged`).
			const epochBefore = tracker.epoch;
			tracker.reset();
			assert.notStrictEqual(tracker.epoch, epochBefore, 'reset should bump the epoch');

			const epochAfterReset = tracker.epoch;
			tracker.dispose();
			assert.notStrictEqual(tracker.epoch, epochAfterReset, 'dispose should bump the epoch');

			// An unchanged tracker keeps its epoch stable — same-generation registrations stay valid.
			const stable = new SubscriptionTracker();
			const e = stable.epoch;
			stable.track(sinon.spy());
			assert.strictEqual(stable.epoch, e, 'track must not bump the epoch');
		});

		test('callerSession reads the bound resolver; undefined before one is bound', () => {
			const tracker = new SubscriptionTracker();
			assert.strictEqual(tracker.callerSession, undefined, 'no resolver bound yet');

			tracker.bindCallerSession(() => 7);
			assert.strictEqual(tracker.callerSession, 7);

			tracker.bindCallerSession(() => undefined);
			assert.strictEqual(tracker.callerSession, undefined, 'a bound resolver can still report undefined');
		});

		test('releaseAllExcept disposes every other session and keeps the given session live', () => {
			const tracker = new SubscriptionTracker();
			const registrations = new Set<EventRegistration>();
			const disposeA = sinon.spy();
			const disposeB1 = sinon.spy();
			const disposeB2 = sinon.spy();

			tracker.bindCallerSession(() => 1);
			trackRpcRegistration(registrations, tracker, () => disposeA);
			tracker.bindCallerSession(() => 2);
			trackRpcRegistration(registrations, tracker, () => disposeB1);
			// Two concurrent registrations from the SAME session — both must survive.
			trackRpcRegistration(registrations, tracker, () => disposeB2);

			tracker.releaseAllExcept(2);

			assert.strictEqual(disposeA.callCount, 1, 'session 1 is released');
			assert.strictEqual(disposeB1.callCount, 0, 'session 2 stays live');
			assert.strictEqual(disposeB2.callCount, 0, 'a second same-session registration also stays live');
			assert.strictEqual(tracker.size, 2, 'only the two session-2 registrations remain tracked');
		});

		test('releaseSession disposes only the given session, leaving every other session tracked', () => {
			const tracker = new SubscriptionTracker();
			const registrations = new Set<EventRegistration>();
			const disposeLive = sinon.spy();
			const disposeStraggler = sinon.spy();

			tracker.bindCallerSession(() => 1);
			trackRpcRegistration(registrations, tracker, () => disposeLive);
			tracker.bindCallerSession(() => 2);
			trackRpcRegistration(registrations, tracker, () => disposeStraggler);

			tracker.releaseSession(2);

			assert.strictEqual(disposeStraggler.callCount, 1, 'the straggler session is released');
			assert.strictEqual(disposeLive.callCount, 0, 'the other session is untouched');
			assert.strictEqual(tracker.size, 1, 'only the live session remains tracked');
		});

		test('releaseSession is a no-op for undefined — nothing to attribute it to', () => {
			const tracker = new SubscriptionTracker();
			const registrations = new Set<EventRegistration>();
			const dispose = sinon.spy();
			trackRpcRegistration(registrations, tracker, () => dispose); // unbound resolver → session undefined

			tracker.releaseSession(undefined);

			assert.strictEqual(dispose.callCount, 0);
			assert.strictEqual(tracker.size, 1);
		});

		test("isSessionReleased is true for an explicitly released or actually-released session, never for one that has yet to validate or merely isn't the new keeper", () => {
			const tracker = new SubscriptionTracker();
			assert.strictEqual(tracker.isSessionReleased(undefined), false);
			assert.strictEqual(tracker.isSessionReleased(1), false);

			tracker.releaseSession(1);
			assert.strictEqual(tracker.isSessionReleased(1), true);
			assert.strictEqual(tracker.isSessionReleased(undefined), false, 'undefined is never "released"');

			// The FIRST validation has nothing tracked or reserved for any other session — nobody was
			// actually released, so nobody besides an explicit releaseSession() call reads as released.
			tracker.releaseAllExcept(2);
			assert.strictEqual(
				tracker.isSessionReleased(3),
				false,
				'a session that never validated is not "released" merely for not being the kept one',
			);

			// Session 2 (the first keeper) registers something for real, then a SECOND validation
			// supersedes it — now its ACTUALLY-released registration marks it tombstoned, but the new
			// keeper (4) is not tombstoned merely for having just been superseded-from.
			const registrations = new Set<EventRegistration>();
			tracker.bindCallerSession(() => 2);
			trackRpcRegistration(registrations, tracker, () => sinon.spy());
			tracker.releaseAllExcept(4);
			assert.strictEqual(
				tracker.isSessionReleased(2),
				true,
				'a session whose registration was actually released by this call is tombstoned',
			);
			assert.strictEqual(tracker.isSessionReleased(4), false, 'the newly-kept session is not released');
		});

		test('reset() clears released-session tombstones — a pre-reset session id is not "released" in the next generation', () => {
			const tracker = new SubscriptionTracker();

			tracker.releaseSession(1);
			assert.strictEqual(tracker.isSessionReleased(1), true, 'precondition: session 1 is tombstoned');

			tracker.reset();
			assert.strictEqual(
				tracker.isSessionReleased(1),
				false,
				'a reset must clear tombstones — the id can never be legitimately referenced again, so nothing should grow unbounded across reconnects',
			);
		});

		test('a released interloper cannot re-register on its already-resolved handshake', () => {
			const tracker = new SubscriptionTracker();
			const registrations = new Set<EventRegistration>();
			const disposeA = sinon.spy();
			const disposeB1 = sinon.spy();
			const disposeB2 = sinon.spy();

			// A registers, B registers (an interloper — never itself validated).
			tracker.bindCallerSession(() => 1);
			trackRpcRegistration(registrations, tracker, () => disposeA);
			tracker.bindCallerSession(() => 2);
			trackRpcRegistration(registrations, tracker, () => disposeB1);

			// A validates — B's registration is released (and B is tombstoned for it).
			tracker.bindCallerSession(() => 1);
			tracker.releaseAllExcept(1);
			assert.strictEqual(disposeB1.callCount, 1, 'B is released at validation');
			assert.strictEqual(tracker.isSessionReleased(2), true, 'B is tombstoned for its released registration');

			// B calls another subscribe method on its already-resolved handshake.
			tracker.bindCallerSession(() => 2);
			trackRpcRegistration(registrations, tracker, () => disposeB2);

			assert.strictEqual(
				disposeB2.callCount,
				1,
				'a released interloper must not be able to attach a new registration',
			);
			assert.strictEqual(tracker.size, 1, 'only A remains tracked');
		});

		test('remount regression guard: a fresh session registering before its own validation is not tombstoned, and delivery is exactly-once from the new mount', () => {
			const tracker = new SubscriptionTracker();
			const rpcEvent = createRpcEvent<number>('thing', 'save-last');

			// Original mount: session 1 registers, then validates.
			tracker.bindCallerSession(() => 1);
			const receivedOld: number[] = [];
			rpcEvent.subscribe(undefined, tracker)(data => receivedOld.push(data));
			tracker.releaseAllExcept(1);

			// A same-connection remount: a NEW post-reset session registers BEFORE its own connect()
			// validates — this must NOT read as released merely for not being the currently-kept
			// session (the near-miss this whole mechanism exists to avoid).
			tracker.bindCallerSession(() => 7);
			const receivedNew: number[] = [];
			rpcEvent.subscribe(undefined, tracker)(data => receivedNew.push(data));
			assert.strictEqual(
				tracker.isSessionReleased(7),
				false,
				'a fresh remount session must not be tombstoned before its own validation',
			);

			// Its own connect() now validates, superseding the old mount.
			tracker.releaseAllExcept(7);

			rpcEvent.fire(42);
			assert.deepStrictEqual(receivedOld, [], 'the superseded mount must not receive the event');
			assert.deepStrictEqual(receivedNew, [42], 'delivery is exactly-once, from the new mount only');
		});

		test('an async subscription method disposes its late resource when its OWN (previously-kept) session is superseded mid-acquisition', async () => {
			const tracker = new SubscriptionTracker();
			const disposeLateSpy = sinon.spy();
			let resolveAcquire!: () => void;

			// Mirrors `RepositoryService.onRepositoryOrWorktreeChanged`'s guard shape exactly: capture
			// epoch and caller session before the await, reserve the session so it's visible to a
			// validation landing mid-acquisition, then re-check both after the resource resolves.
			async function subscribeAsync(): Promise<Unsubscribe> {
				const epoch = tracker.epoch;
				const session = tracker.callerSession;
				const unreserve = tracker.reserveSession(session);
				try {
					await new Promise<void>(resolve => {
						resolveAcquire = resolve;
					});
					if (tracker.epoch !== epoch || tracker.isSessionReleased(session)) {
						disposeLateSpy();
						return () => {};
					}

					return tracker.track(() => {});
				} finally {
					unreserve();
				}
			}

			// Session 1 is already the validated, active client — the realistic precondition for an
			// app-level async subscription method ever being called (client-side, `connect()` always
			// runs, and validates, before any app-level subscription).
			tracker.bindCallerSession(() => 1);
			tracker.releaseAllExcept(1);

			const pending = subscribeAsync(); // captures and reserves session=1 before its own await

			// A different session validates while the acquisition is in flight — session 1 has nothing
			// tracked yet (only reserved), so this is the case the reservation exists to catch.
			tracker.releaseAllExcept(2);

			resolveAcquire();
			await pending;

			assert.strictEqual(disposeLateSpy.callCount, 1, 'the late resource must be disposed, not installed');
			assert.strictEqual(tracker.size, 0, 'nothing should end up tracked for the released session');
		});

		test('an in-flight interloper that NEVER validated is superseded via its reservation, not by having been a previous keeper', async () => {
			const tracker = new SubscriptionTracker();
			const disposeLateSpy = sinon.spy();
			let resolveAcquire!: () => void;

			async function subscribeAsync(): Promise<Unsubscribe> {
				const epoch = tracker.epoch;
				const session = tracker.callerSession;
				const unreserve = tracker.reserveSession(session);
				try {
					await new Promise<void>(resolve => {
						resolveAcquire = resolve;
					});
					if (tracker.epoch !== epoch || tracker.isSessionReleased(session)) {
						disposeLateSpy();
						return () => {};
					}

					return tracker.track(() => {});
				} finally {
					unreserve();
				}
			}

			// B (session 2) has NEVER validated — there is no previous keeper for `releaseAllExcept`
			// to supersede, so only its reservation makes it visible.
			tracker.bindCallerSession(() => 2);
			const pending = subscribeAsync(); // captures and reserves session=2 before its own await

			// A (session 1) validates for the FIRST TIME while B's acquisition is still in flight.
			tracker.releaseAllExcept(1);

			resolveAcquire();
			await pending;

			assert.strictEqual(disposeLateSpy.callCount, 1, "B's late resource must be disposed, not installed");
			assert.strictEqual(tracker.size, 0, 'nothing should end up tracked for the interloper');
		});

		test('a keeper that validated while IDLE is still tombstoned when superseded, and cannot register afterward', () => {
			const tracker = new SubscriptionTracker();
			const rpcEvent = createRpcEvent<number>('thing', 'save-last');

			// A (session 1) validates with NOTHING tracked and NOTHING reserved — the release scans
			// find no trace of it, so only remembering it as the active keeper makes it releasable.
			tracker.bindCallerSession(() => 1);
			tracker.releaseAllExcept(1);

			// B (session 2) validates, superseding A.
			tracker.bindCallerSession(() => 2);
			tracker.releaseAllExcept(2);
			assert.strictEqual(tracker.isSessionReleased(1), true, 'the superseded idle keeper must be tombstoned');

			// A now tries to register — it must be refused, not attached.
			tracker.bindCallerSession(() => 1);
			const received: number[] = [];
			rpcEvent.subscribe(undefined, tracker)(data => received.push(data));
			rpcEvent.fire(42);
			assert.deepStrictEqual(received, [], 'the superseded keeper must not be able to attach a registration');
			assert.strictEqual(tracker.size, 0, 'nothing should end up tracked for the superseded keeper');
		});

		test('concurrent same-session reservations are refcounted: releasing one keeps the session visible to validation', () => {
			const tracker = new SubscriptionTracker();
			tracker.bindCallerSession(() => 2);

			// Two overlapping async acquisitions from the same session, each with its own handle.
			const unreserveFirst = tracker.reserveSession(2);
			tracker.reserveSession(2);

			// The first resolves (and even releases its handle twice — a one-shot no-op) while the
			// second is still in flight.
			unreserveFirst();
			unreserveFirst();

			// A validation landing now must still see session 2 via the second reservation.
			tracker.releaseAllExcept(1);
			assert.strictEqual(
				tracker.isSessionReleased(2),
				true,
				'the still-in-flight reservation must keep the session visible to validation',
			);
		});

		test('a synchronous same-session registration does not clear an unrelated in-flight reservation', () => {
			const tracker = new SubscriptionTracker();
			const rpcEvent = createRpcEvent<number>('thing', 'save-last');
			tracker.bindCallerSession(() => 2);

			// An async acquisition from session 2 is in flight (reserved, nothing tracked yet)...
			tracker.reserveSession(2);

			// ...when a SYNCHRONOUS registration from the same session attaches and immediately
			// unsubscribes, leaving nothing tracked for session 2 again.
			const unsubscribe = rpcEvent.subscribe(undefined, tracker)(() => {}) as () => void;
			unsubscribe();

			// A validation landing now must still see session 2 via the untouched reservation.
			tracker.releaseAllExcept(1);
			assert.strictEqual(
				tracker.isSessionReleased(2),
				true,
				'the reservation must survive an unrelated synchronous registration from the same session',
			);
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

		test('fire is a safe no-op with no subscribers (eager-independence — #5513)', () => {
			// SubscriptionService's eager listener fires on every change regardless of whether a client
			// has subscribed, keeping the bridged signal fresh either way (#5513) — so fire() must not
			// depend on there being any handlers.
			const event = createRpcEvent<string>('key', 'save-last');
			assert.doesNotThrow(() => event.fire('no-subscribers'));
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

		test('two concurrent subscribers both receive (same generation, no supersede)', () => {
			const event = createRpcEvent<number>('thing', 'save-last');
			const sub = event.subscribe(undefined, undefined);
			const a: number[] = [];
			const b: number[] = [];

			sub(n => a.push(n));
			sub(n => b.push(n));
			event.fire(1);

			assert.deepStrictEqual({ a: a, b: b }, { a: [1], b: [1] }, 'both concurrent subscribers must receive');
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

	suite('trackRpcRegistration teardown ordering', () => {
		test('createRpcEvent: registering against an already-disposed tracker does not throw and leaves no live handler', () => {
			const tracker = new SubscriptionTracker();
			tracker.dispose();

			const event = createRpcEvent<string>('key', 'save-last');
			const subscriber = event.subscribe(undefined, tracker);
			const cb = sinon.spy();

			let unsub!: () => void;
			assert.doesNotThrow(() => {
				unsub = subscriber(cb) as () => void;
			});

			event.fire('data');
			assert.strictEqual(cb.callCount, 0, 'handler must not be live after synchronous teardown');
			assert.doesNotThrow(() => unsub());
		});

		test('createRpcEventSubscription: registering against an already-disposed tracker does not throw and leaves no live listener', () => {
			const tracker = new SubscriptionTracker();
			tracker.dispose();

			const emitter = new Emitter<string>();
			const disposeSpy = sinon.spy();
			const subscriber = createRpcEventSubscription<string>(
				undefined,
				'key',
				'save-last',
				handler => {
					const listener = emitter.event(handler);
					return {
						dispose: () => {
							disposeSpy();
							listener.dispose();
						},
					};
				},
				undefined,
				tracker,
			);
			const cb = sinon.spy();

			let unsub!: () => void;
			assert.doesNotThrow(() => {
				unsub = subscriber(cb) as () => void;
			});

			emitter.fire('data');
			assert.strictEqual(cb.callCount, 0, 'listener must not be live after synchronous teardown');
			assert.strictEqual(disposeSpy.callCount, 1, 'attach must be torn down synchronously, not left dangling');
			assert.doesNotThrow(() => unsub());
		});

		test('attachment throwing propagates, leaves the tracker untouched, and a later reset() still completes', () => {
			const tracker = new SubscriptionTracker();
			const registrations = new Set<EventRegistration>();
			const failure = new Error('attach failed');

			assert.throws(() => {
				trackRpcRegistration(registrations, tracker, () => {
					throw failure;
				});
			}, failure);

			assert.strictEqual(registrations.size, 0, 'nothing should be registered after a failed attach');
			assert.strictEqual(tracker.size, 0, 'nothing should be tracked after a failed attach');
			assert.doesNotThrow(() => tracker.reset(), 'reset must still complete cleanly');
		});

		test('reentrant disposal during attach does not double-teardown and leaves no live listener', () => {
			const tracker = new SubscriptionTracker();
			const registrations = new Set<EventRegistration>();
			const emitter = new Emitter<string>();
			const teardownSpy = sinon.spy();
			const received: string[] = [];

			const tracked = trackRpcRegistration(registrations, tracker, () => {
				// Reentrant: something the attach step touches disposes the tracker before
				// attach returns its teardown (e.g. a synchronous session-reset callback).
				tracker.dispose();
				const listener = emitter.event(v => received.push(v));
				return () => {
					teardownSpy();
					listener.dispose();
				};
			});

			emitter.fire('after-reentrant-dispose');
			assert.deepStrictEqual(received, [], 'a listener attached during reentrant disposal must not stay live');
			assert.strictEqual(teardownSpy.callCount, 1, 'teardown must run exactly once');
			assert.strictEqual(registrations.size, 0, 'no registration should remain after reentrant disposal');

			assert.doesNotThrow(() => (tracked as () => void)());
			assert.strictEqual(teardownSpy.callCount, 1, 'calling the returned unsubscribe again must not re-teardown');
		});
	});
});
