import * as assert from 'assert';
import * as sinon from 'sinon';
import {
	createBufferedCallback,
	createEventSubscription,
	EventVisibilityBuffer,
	SubscriptionTracker,
} from '../eventVisibilityBuffer.js';

suite('EventVisibilityBuffer Stress Test Suite', () => {
	suite('20-subscription scale (Graph webview simulation)', () => {
		const eventKeys = [
			'rowsChanged',
			'avatarsChanged',
			'refsMetadataChanged',
			'rowsStatsChanged',
			'scrollMarkersChanged',
			'workingTreeChanged',
			'branchStateChanged',
			'selectionChanged',
			'configChanged',
			'columnsChanged',
			'refsVisibilityChanged',
			'searchResults',
			'subscriptionChanged',
			'repoConnectionChanged',
			'fetchCompleted',
			'featurePreviewChanged',
			'orgSettingsChanged',
			'mcpBannerChanged',
			'windowFocusChanged',
			'repositoryChanged',
		];

		test('should handle 20 distinct event keys while hidden, each fires latest on restore', () => {
			const buffer = new EventVisibilityBuffer();
			const callbacks = new Map<string, sinon.SinonSpy>();

			// Set up 20 buffered callbacks
			for (const key of eventKeys) {
				const spy = sinon.spy();
				callbacks.set(key, spy);
			}

			buffer.setVisible(false);

			// Fire each event 5 times with different data
			for (let round = 0; round < 5; round++) {
				for (const key of eventKeys) {
					const buffered = createBufferedCallback(buffer, key, callbacks.get(key)!, 'save-last');
					buffered(`${key}-data-round-${round}`);
				}
			}

			// No callbacks should have fired while hidden
			for (const [key, spy] of callbacks) {
				assert.strictEqual(spy.callCount, 0, `${key} should not fire while hidden`);
			}

			// Restore visibility
			buffer.setVisible(true);

			// Each should fire exactly once with the latest data (round 4)
			for (const [key, spy] of callbacks) {
				assert.strictEqual(spy.callCount, 1, `${key} should fire exactly once on restore`);
				assert.strictEqual(
					spy.firstCall.args[0],
					`${key}-data-round-4`,
					`${key} should have latest data (round 4)`,
				);
			}
		});

		test('should clear all pending after flush — second visibility toggle fires nothing', () => {
			const buffer = new EventVisibilityBuffer();
			const spies: sinon.SinonSpy[] = [];

			buffer.setVisible(false);

			for (const key of eventKeys) {
				const spy = sinon.spy();
				spies.push(spy);
				buffer.addPending(key, spy);
			}

			// First flush
			buffer.setVisible(true);
			for (const spy of spies) {
				assert.strictEqual(spy.callCount, 1);
			}

			// Second hide/show should NOT re-fire
			buffer.setVisible(false);
			buffer.setVisible(true);
			for (const spy of spies) {
				assert.strictEqual(spy.callCount, 1, 'should not fire again after clear');
			}
		});

		test('should handle interleaved add/remove while hidden', () => {
			const buffer = new EventVisibilityBuffer();
			const survivorSpy = sinon.spy();
			const removedSpy = sinon.spy();

			buffer.setVisible(false);

			// Add all 20
			for (const key of eventKeys) {
				buffer.addPending(key, key === eventKeys[0] ? removedSpy : survivorSpy);
			}

			// Remove the first one
			buffer.removePending(eventKeys[0]);

			buffer.setVisible(true);

			assert.strictEqual(removedSpy.callCount, 0, 'removed event should not fire');
			assert.strictEqual(survivorSpy.callCount, eventKeys.length - 1, 'remaining events should all fire');
		});

		test('should handle mixed save-last and signal modes across 20 events', () => {
			const buffer = new EventVisibilityBuffer();
			const results: Array<{ key: string; value: unknown }> = [];

			buffer.setVisible(false);

			for (let i = 0; i < eventKeys.length; i++) {
				const key = eventKeys[i];
				const mode = i % 2 === 0 ? 'save-last' : 'signal';
				const signalValue = mode === 'signal' ? undefined : undefined;

				const callback = (data: unknown) => {
					results.push({ key: key, value: data });
				};

				const buffered = createBufferedCallback(buffer, key, callback, mode, signalValue);
				buffered(`${key}-actual-data`);
			}

			buffer.setVisible(true);

			assert.strictEqual(results.length, eventKeys.length, 'all 20 events should fire');

			for (let i = 0; i < eventKeys.length; i++) {
				const result = results.find(r => r.key === eventKeys[i])!;
				assert.ok(result, `${eventKeys[i]} should have fired`);

				if (i % 2 === 0) {
					// save-last: should have actual data
					assert.strictEqual(result.value, `${eventKeys[i]}-actual-data`);
				} else {
					// signal: should have undefined (signalValue)
					assert.strictEqual(result.value, undefined);
				}
			}
		});
	});

	suite('SubscriptionTracker at scale', () => {
		test('should track and dispose 20 subscriptions', () => {
			const tracker = new SubscriptionTracker();
			const unsubscribes: sinon.SinonSpy[] = [];

			for (let i = 0; i < 20; i++) {
				const spy = sinon.spy();
				unsubscribes.push(spy);
				tracker.track(spy);
			}

			tracker.dispose();

			for (let i = 0; i < 20; i++) {
				assert.strictEqual(unsubscribes[i].callCount, 1, `subscription ${i} should be disposed`);
			}
		});

		test('should handle partial manual unsubscription before dispose', () => {
			const tracker = new SubscriptionTracker();
			const unsubscribes: sinon.SinonSpy[] = [];
			const tracked: Array<() => void> = [];

			for (let i = 0; i < 20; i++) {
				const spy = sinon.spy();
				unsubscribes.push(spy);
				tracked.push(tracker.track(spy));
			}

			// Manually unsubscribe every other one
			for (let i = 0; i < 20; i += 2) {
				tracked[i]();
			}

			// Verify manually unsubscribed ones were called
			for (let i = 0; i < 20; i += 2) {
				assert.strictEqual(unsubscribes[i].callCount, 1, `subscription ${i} should be unsubscribed`);
			}

			// Dispose remainder
			tracker.dispose();

			// All should have been called exactly once
			for (let i = 0; i < 20; i++) {
				assert.strictEqual(unsubscribes[i].callCount, 1, `subscription ${i} should be called exactly once`);
			}
		});
	});

	suite('createEventSubscription with SubscriptionTracker at scale', () => {
		test('should set up and tear down 20 event subscriptions via tracker', () => {
			const buffer = new EventVisibilityBuffer();
			const tracker = new SubscriptionTracker();
			const disposeSpies: sinon.SinonSpy[] = [];
			const eventCallbacks: sinon.SinonSpy[] = [];

			for (const key of [
				'rowsChanged',
				'avatarsChanged',
				'refsMetadataChanged',
				'rowsStatsChanged',
				'scrollMarkersChanged',
				'workingTreeChanged',
				'branchStateChanged',
				'selectionChanged',
				'configChanged',
				'columnsChanged',
				'refsVisibilityChanged',
				'searchResults',
				'subscriptionChanged',
				'repoConnectionChanged',
				'fetchCompleted',
				'featurePreviewChanged',
				'orgSettingsChanged',
				'mcpBannerChanged',
				'windowFocusChanged',
				'repositoryChanged',
			]) {
				const disposeSpy = sinon.spy();
				disposeSpies.push(disposeSpy);

				const subscriber = createEventSubscription<string>(
					buffer,
					key,
					'save-last',
					_callback => ({ dispose: disposeSpy }),
					undefined,
					tracker,
				);

				const eventCallback = sinon.spy();
				eventCallbacks.push(eventCallback);
				subscriber(eventCallback);
			}

			// All 20 subscriptions active — none disposed yet
			for (const spy of disposeSpies) {
				assert.strictEqual(spy.callCount, 0);
			}

			// Simulate reconnection: dispose all tracked subscriptions
			tracker.dispose();

			// All 20 should be disposed
			for (let i = 0; i < disposeSpies.length; i++) {
				assert.strictEqual(
					disposeSpies[i].callCount,
					1,
					`subscription ${i} should be disposed on tracker.dispose()`,
				);
			}
		});
	});
});
