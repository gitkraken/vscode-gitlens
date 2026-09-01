import * as assert from 'assert';
import { EventLoopMonitor } from '../eventLoopMonitor.js';

type TestableMonitor = { record(endMs: number, lagMs: number): void };

function asTestable(monitor: EventLoopMonitor): TestableMonitor {
	return monitor as unknown as TestableMonitor;
}

suite('EventLoopMonitor Test Suite', () => {
	suite('maxDelaySince windowing', () => {
		test('returns 0 when nothing has been recorded', () => {
			const monitor = new EventLoopMonitor();
			assert.strictEqual(monitor.maxDelaySince(0), 0);
		});

		test('ignores samples below the recording threshold', () => {
			const monitor = new EventLoopMonitor();
			asTestable(monitor).record(1000, 49);
			assert.strictEqual(monitor.maxDelaySince(0), 0);
		});

		test('returns the max lag among samples ending at or after the given time', () => {
			const monitor = new EventLoopMonitor();
			const testable = asTestable(monitor);
			testable.record(1000, 100);
			testable.record(2000, 900);
			testable.record(3000, 200);

			assert.strictEqual(monitor.maxDelaySince(0), 900);
			assert.strictEqual(monitor.maxDelaySince(2000), 900);
			assert.strictEqual(monitor.maxDelaySince(2001), 200);
			assert.strictEqual(monitor.maxDelaySince(3001), 0);
		});

		test('evicts the oldest samples once the ring is full', () => {
			const monitor = new EventLoopMonitor();
			const testable = asTestable(monitor);

			testable.record(0, 99999);
			for (let i = 1; i <= 480; i++) {
				testable.record(i, 60);
			}

			assert.strictEqual(monitor.maxDelaySince(0), 60);
		});

		test('stop() clears recorded samples', () => {
			const monitor = new EventLoopMonitor();
			const testable = asTestable(monitor);
			testable.record(1000, 100);
			assert.strictEqual(monitor.maxDelaySince(0), 100);

			monitor.stop();
			assert.strictEqual(monitor.maxDelaySince(0), 0);
		});
	});

	suite('lifecycle', () => {
		test('start() and stop() are idempotent', () => {
			const monitor = new EventLoopMonitor();
			monitor.start();
			monitor.start();
			monitor.stop();
			monitor.stop();
			monitor.dispose();
		});

		test('smoke: a real event-loop stall is detected', async () => {
			const monitor = new EventLoopMonitor();
			const beforeMs = Date.now();
			monitor.start();

			try {
				// Repeatedly block the loop in short bursts, yielding briefly between them, until the
				// monitor's heartbeat has had a chance to land inside one of the busy windows. A single
				// fixed-duration burst can't guarantee overlap with the heartbeat's own interval, so this
				// keeps the test flake-proof while still exercising a real stall end to end.
				const deadlineMs = Date.now() + 5000;
				while (Date.now() < deadlineMs && monitor.maxDelaySince(beforeMs) === 0) {
					const busyUntilMs = Date.now() + 100;
					while (Date.now() < busyUntilMs) {
						// busy-wait to block the event loop
					}

					await new Promise(resolve => setTimeout(resolve, 0));
				}

				assert.ok(monitor.maxDelaySince(beforeMs) > 0);
			} finally {
				monitor.stop();
			}
		});
	});
});
