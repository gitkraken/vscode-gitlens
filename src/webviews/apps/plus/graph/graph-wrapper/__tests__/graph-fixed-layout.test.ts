import * as assert from 'assert';
import { fixedSizeVertical, FixedSizeVerticalLayout } from '../graph-fixed-layout.js';
import { RowUnitsIndex } from '../graph-row-units.js';

// Minimal shape of the layout's `stateChanged` host message (the package doesn't export the type).
type StateChanged = {
	type: string;
	scrollSize: { height: number };
	range: { first: number; last: number };
	childPositions: Map<number, { top: number; left: number }>;
};

// `_first`/`_last`/`_physicalMin`/`_physicalMax` are `protected` on the package's (unexported)
// `BaseLayout` — plain runtime properties, just not part of any `.d.ts` we can import — so this is a
// narrow structural cast to read them, the same idea as this file's `LayoutPositions`/`LayoutSize`
// mirrors above.
type LayoutInternals = { _first: number; _last: number; _physicalMin: number; _physicalMax: number };
function internals(layout: FixedSizeVerticalLayout): LayoutInternals {
	return layout as unknown as LayoutInternals;
}

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

	test('the specifier factory carries an optional units index', () => {
		const units = RowUnitsIndex.build(10, idx => (idx === 2 ? 2 : 1));
		const spec = fixedSizeVertical(46, units);
		assert.strictEqual(spec.itemSize, 46);
		assert.strictEqual(spec.units, units);
	});

	test('a tall row (units index) shifts every following row down by its extra units', () => {
		const layout = new FixedSizeVerticalLayout(() => {});
		layout.itemSize = 24;
		// Row 5 spans 2 units; everything from row 6 on shifts down by 1 extra unit.
		layout.units = RowUnitsIndex.build(100, idx => (idx === 5 ? 2 : 1));

		assert.strictEqual(layout._getItemPosition(5).top, 5 * 24);
		assert.strictEqual(layout._getItemSize(5).height, 2 * 24);
		assert.strictEqual(layout._getItemPosition(6).top, (5 + 2) * 24);
	});

	test('reflow reports scroll size inflated by tall rows', () => {
		const messages: unknown[] = [];
		const layout = new FixedSizeVerticalLayout(m => messages.push(m));
		layout.itemSize = 24;
		layout.units = RowUnitsIndex.build(100, idx => (idx === 5 ? 2 : 1));
		layout.items = new Array(100).fill(0);
		layout.viewportSize = { width: 300, height: 240 };
		layout.viewportScroll = { top: 0, left: 0 };
		messages.length = 0;
		layout.reflowIfNeeded(true);

		const msg = messages.find(m => (m as StateChanged).type === 'stateChanged') as StateChanged | undefined;
		assert.ok(msg != null, 'expected a stateChanged message');
		// 100 rows + 1 extra unit from the single tall row.
		assert.strictEqual(msg.scrollSize.height, 101 * 24);
	});

	test('active range and physical bounds when the viewport edge lands mid-tall-row', () => {
		const layout = new FixedSizeVerticalLayout(() => {});
		layout.itemSize = 24;
		// Row 50 spans 5 units — pixels [1200, 1320) — with no earlier tall rows shifting it.
		layout.units = RowUnitsIndex.build(100, idx => (idx === 50 ? 5 : 1));
		layout.items = new Array(100).fill(0);
		layout.viewportSize = { width: 300, height: 100 };
		// scrollPosition(2250) - overhang(1000) = 1250, which lands inside [1200, 1320), not at its edge.
		layout.viewportScroll = { top: 2250, left: 0 };
		layout.reflowIfNeeded(true);

		const state = internals(layout);
		assert.strictEqual(state._first, 50, 'expected the straddled tall row to be the first active row');
		assert.ok(state._physicalMin <= 1250, 'physicalMin must cover the requested min');
		assert.ok(state._physicalMax >= 2496, 'physicalMax must cover the requested max');
	});

	test('a scroll sweep across a tall-row boundary never regresses the active range', () => {
		const layout = new FixedSizeVerticalLayout(() => {});
		layout.itemSize = 24;
		layout.units = RowUnitsIndex.build(100, idx => (idx === 50 ? 5 : 1));
		layout.items = new Array(100).fill(0);
		layout.viewportSize = { width: 300, height: 100 };

		let prevFirst = -1;
		let prevLast = -1;
		for (const scrollTop of [0, 300, 600, 900, 1200, 1500, 1800, 2100, 2400, 2496]) {
			layout.viewportScroll = { top: scrollTop, left: 0 };
			layout.reflowIfNeeded(true);

			const state = internals(layout);
			assert.ok(state._first >= prevFirst, `first must not regress at top=${scrollTop}`);
			assert.ok(state._last >= prevLast, `last must not regress at top=${scrollTop}`);
			prevFirst = state._first;
			prevLast = state._last;
		}
	});

	test('units is a guarded setter (same instance is a no-op; a new instance reflows)', () => {
		const messages: unknown[] = [];
		const layout = new FixedSizeVerticalLayout(m => messages.push(m));
		layout.itemSize = 24;
		layout.items = new Array(100).fill(0);
		layout.viewportSize = { width: 300, height: 240 };
		layout.viewportScroll = { top: 0, left: 0 };
		layout.reflowIfNeeded(true);

		const sameUnits = RowUnitsIndex.build(100, idx => (idx === 5 ? 2 : 1));
		layout.units = sameUnits;
		layout.reflowIfNeeded(true);
		messages.length = 0;

		// Re-applying the identical instance (the virtualize directive does this every render) must not
		// schedule a reflow, so a non-forced call finds nothing pending.
		layout.units = sameUnits;
		layout.reflowIfNeeded(false);
		assert.strictEqual(messages.length, 0, 'expected no stateChanged message when re-applying the same instance');

		// A genuinely new instance — even with identical tall rows — is a real change.
		const newUnits = RowUnitsIndex.build(100, idx => (idx === 5 ? 2 : 1));
		layout.units = newUnits;
		layout.reflowIfNeeded(false);
		assert.ok(
			messages.some(m => (m as StateChanged).type === 'stateChanged'),
			'expected a stateChanged message when setting a new units instance',
		);
	});

	test('with RowUnitsIndex.uniform set explicitly, positions match the pre-units fast path', () => {
		const layout = new FixedSizeVerticalLayout(() => {});
		layout.itemSize = 24;
		layout.units = RowUnitsIndex.uniform;

		assert.strictEqual(layout._getItemPosition(0).top, 0);
		assert.strictEqual(layout._getItemPosition(1).top, 24);
		assert.strictEqual(layout._getItemPosition(10).top, 240);
		assert.strictEqual(layout._getItemPosition(0).left, 0);
		assert.strictEqual(layout._getItemSize(3).height, 24);
	});

	test('with RowUnitsIndex.uniform set explicitly, reflow reports the same scroll size and range as before', () => {
		const messages: unknown[] = [];
		const layout = new FixedSizeVerticalLayout(m => messages.push(m));
		layout.itemSize = 24;
		layout.units = RowUnitsIndex.uniform;
		layout.items = new Array(100).fill(0);
		layout.viewportSize = { width: 300, height: 240 };
		layout.viewportScroll = { top: 0, left: 0 };
		messages.length = 0;
		layout.reflowIfNeeded(true);

		const msg = messages.find(m => (m as StateChanged).type === 'stateChanged') as StateChanged | undefined;
		assert.ok(msg != null, 'expected a stateChanged message');
		assert.strictEqual(msg.scrollSize.height, 100 * 24);
		assert.strictEqual(msg.range.first, 0);
		assert.strictEqual(msg.range.last, 51);
		assert.strictEqual(msg.childPositions.get(51)?.top, 51 * 24);
	});
});
