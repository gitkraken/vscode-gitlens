import * as assert from 'assert';
import type { ReactiveControllerHost } from 'lit';
import { VirtualScrollController } from '../virtual-scroll.js';

suite('VirtualScrollController first-layout kick', () => {
	test('a virtualizer disconnected before its first layout settles skips the re-slice instead of rejecting', async () => {
		const host: ReactiveControllerHost = {
			addController: () => undefined,
			removeController: () => undefined,
			requestUpdate: () => undefined,
			updateComplete: Promise.resolve(true),
		};
		const scroll = new VirtualScrollController(host, {
			getVirtualizer: () =>
				({ layoutComplete: Promise.reject(new Error('disconnected')) }) as unknown as HTMLElement,
			getCount: () => 1,
		});

		let reslices = 0;
		await scroll.kickAfterFirstLayout(() => reslices++);
		assert.strictEqual(reslices, 0);
	});
});
