import * as assert from 'assert';
import type { FrameScheduler } from '../frame.js';
import { FrameCoalescer } from '../frame.js';

suite('FrameCoalescer', () => {
	test('schedules made in separate tasks before a frame run the callback once', async () => {
		const pending: (() => void)[] = [];
		const frames: FrameScheduler = {
			request: callback => pending.push(callback),
			cancel: () => {},
		};
		let updates = 0;
		const coalescer = new FrameCoalescer(() => updates++, frames);

		for (let i = 0; i < 5; i++) {
			await Promise.resolve();
			coalescer.schedule();
		}
		for (const run of pending.splice(0)) {
			run();
		}
		assert.strictEqual(updates, 1);

		coalescer.schedule();
		for (const run of pending.splice(0)) {
			run();
		}
		assert.strictEqual(updates, 2);
	});
});
