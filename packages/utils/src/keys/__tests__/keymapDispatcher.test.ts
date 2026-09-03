import * as assert from 'assert';
import type { KeyBindingDescriptor, KeyBindingOverrides } from '../keybinding.js';
import { KeymapDispatcher } from '../keymapDispatcher.js';

type TestScope = 'row';

/** A previous/next pair where BOTH halves carry an id — mirrors `graph.lineagePrevious`/`Next` — the
 *  visible half's `sheet` names the hidden partner via `with` so overriding (or disabling) either
 *  half is reflected in the one row `sheetEntries()` produces for the pair. */
const pairDescriptors: readonly KeyBindingDescriptor<TestScope, KeyboardEvent>[] = [
	{
		id: 'nav.prev',
		keys: ['mod+ArrowUp'],
		scope: 'row',
		sheet: {
			group: 'navigation',
			label: 'Previous / next',
			order: 1,
			keysOverride: ['mod+ArrowUp'],
			with: [{ id: 'nav.next', keys: ['ArrowDown'] }],
		},
		run: () => true,
	},
	{
		id: 'nav.next',
		keys: ['mod+ArrowDown'],
		scope: 'row',
		sheet: 'hidden',
		run: () => true,
	},
];

suite('KeymapDispatcher Test Suite', () => {
	suite('sheetEntries', () => {
		test('a normal row composes the owner keys and the partner segment, with both ids', () => {
			const dispatcher = new KeymapDispatcher<TestScope>({ isMac: false });
			dispatcher.registerBindings(pairDescriptors);

			const rows = dispatcher.sheetEntries();
			assert.strictEqual(rows.length, 1);
			assert.deepStrictEqual(rows[0].keys, ['mod+ArrowUp', 'sep:/', 'ArrowDown']);
			assert.deepStrictEqual(rows[0].ids, ['nav.prev', 'nav.next']);
		});

		test('overriding the partner swaps in its live keys, leaving the owner segment untouched', () => {
			const dispatcher = new KeymapDispatcher<TestScope>({ isMac: false });
			dispatcher.registerBindings(pairDescriptors);

			const overrides: KeyBindingOverrides = { 'nav.next': ['mod+shift+ArrowDown'] };
			dispatcher.setOverrides(overrides);

			const rows = dispatcher.sheetEntries();
			assert.strictEqual(rows.length, 1);
			assert.deepStrictEqual(rows[0].keys, ['mod+ArrowUp', 'sep:/', 'mod+shift+ArrowDown']);
			assert.deepStrictEqual(rows[0].ids, ['nav.prev', 'nav.next']);
		});

		test('disabling the owner still shows a row for the registered partner, with no leading self segment', () => {
			const dispatcher = new KeymapDispatcher<TestScope>({ isMac: false });
			dispatcher.registerBindings(pairDescriptors);

			const overrides: KeyBindingOverrides = { 'nav.prev': false };
			dispatcher.setOverrides(overrides);

			const rows = dispatcher.sheetEntries();
			assert.strictEqual(rows.length, 1);
			assert.deepStrictEqual(rows[0].keys, ['ArrowDown']);
			assert.deepStrictEqual(rows[0].ids, ['nav.next']);
		});

		test('disabling both halves drops the row entirely', () => {
			const dispatcher = new KeymapDispatcher<TestScope>({ isMac: false });
			dispatcher.registerBindings(pairDescriptors);

			const overrides: KeyBindingOverrides = { 'nav.prev': false, 'nav.next': false };
			dispatcher.setOverrides(overrides);

			assert.deepStrictEqual(dispatcher.sheetEntries(), []);
		});

		test('a binding with no `with` partners and no id gets an undefined ids array', () => {
			const dispatcher = new KeymapDispatcher<TestScope>({ isMac: false });
			dispatcher.registerBindings([
				{ keys: ['Tab'], scope: 'row', sheet: { group: 'navigation', label: 'Focus refs' }, run: () => true },
			]);

			const rows = dispatcher.sheetEntries();
			assert.strictEqual(rows.length, 1);
			assert.strictEqual(rows[0].ids, undefined);
		});
	});
});
