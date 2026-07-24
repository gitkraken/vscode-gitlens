import * as assert from 'assert';
import { fixedSizeVertical, FixedSizeVerticalLayout } from '../graph-fixed-layout.js';

// Minimal shape of the layout's `stateChanged` host message (the package doesn't export the type).
type StateChanged = {
	type: string;
	scrollSize: { height: number };
	range: { first: number; last: number };
	childPositions: Map<number, { top: number; left: number }>;
};

suite('graph-fixed-layout — FixedSizeVerticalLayout', () => {
	test('never measures children', () => {
		const layout = new FixedSizeVerticalLayout(() => {});
		assert.strictEqual(layout.measureChildren, false);
	});

	test('positions each row at exactly idx * itemSize', () => {
		const layout = new FixedSizeVerticalLayout(() => {});
		layout.itemSize = 24;
		assert.strictEqual(layout._getItemPosition(0).top, 0);
		assert.strictEqual(layout._getItemPosition(1).top, 24);
		assert.strictEqual(layout._getItemPosition(10).top, 240);
		assert.strictEqual(layout._getItemPosition(0).left, 0);
		assert.strictEqual(layout._getItemSize(3).height, 24);
	});

	test('itemSize is a guarded setter (ignores non-positive and unchanged values)', () => {
		const layout = new FixedSizeVerticalLayout(() => {});
		layout.itemSize = 46;
		assert.strictEqual(layout.itemSize, 46);
		layout.itemSize = 0;
		assert.strictEqual(layout.itemSize, 46);
		layout.itemSize = -5;
		assert.strictEqual(layout.itemSize, 46);
	});

	test('reflow reports exact scroll size and a whole-row active range', () => {
		const messages: unknown[] = [];
		const layout = new FixedSizeVerticalLayout(m => messages.push(m));
		layout.itemSize = 24;
		layout.items = new Array(100).fill(0);
		layout.viewportSize = { width: 300, height: 240 };
		layout.viewportScroll = { top: 0, left: 0 };
		messages.length = 0;
		layout.reflowIfNeeded(true);

		const msg = messages.find(m => (m as StateChanged).type === 'stateChanged') as StateChanged | undefined;
		assert.ok(msg != null, 'expected a stateChanged message');
		assert.strictEqual(msg.scrollSize.height, 100 * 24);
		assert.strictEqual(msg.range.first, 0);
		// viewport 240 + base overhang 1000 = 1240 → ceil(1240 / 24) - 1 = 51.
		assert.strictEqual(msg.range.last, 51);
		assert.strictEqual(msg.childPositions.get(51)?.top, 51 * 24);
	});

	test('the specifier factory carries the row height', () => {
		const spec = fixedSizeVertical(46);
		assert.strictEqual(spec.type, FixedSizeVerticalLayout);
		assert.strictEqual(spec.direction, 'vertical');
		assert.strictEqual(spec.itemSize, 46);
	});
});
