import * as assert from 'assert';
import type { ReactiveControllerHost } from 'lit';
import type { SelectionMode } from '../selection.js';
import { VirtualCollectionController } from '../virtual-collection.js';

function fakeHost(): ReactiveControllerHost {
	return {
		addController: () => undefined,
		removeController: () => undefined,
		requestUpdate: () => undefined,
		updateComplete: Promise.resolve(true),
	};
}

function setup(mode: SelectionMode = 'multi') {
	const items = ['a', 'b', 'c', 'd', 'e'].map(p => ({ path: p }));
	const facade = new VirtualCollectionController(fakeHost(), {
		getItems: () => items,
		getItemId: r => r.path,
		mode: () => mode,
		getVirtualizer: () => undefined,
	});
	facade.index.rebuild();
	return { facade: facade, selectedIds: () => [...facade.selection.selectedIds].sort() };
}

suite('VirtualCollectionController anchor seeding', () => {
	test('hostUpdated seeds the anchor from the focused row (multi, no anchor yet)', () => {
		const { facade } = setup('multi');
		facade.focus.focusIndex(0); // 'a' is the cursor on load
		assert.strictEqual(facade.selection.anchorId, undefined);

		facade.hostUpdated();
		assert.strictEqual(facade.selection.anchorId, 'a');
		assert.deepStrictEqual([...facade.selection.selectedIds], []); // seed pivot only, nothing selected
	});

	test('seeded anchor makes a first selectRange produce a range (the bug fix)', () => {
		const { facade, selectedIds } = setup('multi');
		facade.focus.focusIndex(0); // 'a'
		facade.hostUpdated(); // anchor <- 'a'

		facade.selection.selectRange('c'); // first Shift+click on 'c'
		assert.deepStrictEqual(selectedIds(), ['a', 'b', 'c']);
	});

	test('hostUpdated is a no-op in single mode', () => {
		const { facade } = setup('single');
		facade.focus.focusIndex(0);
		facade.hostUpdated();
		assert.strictEqual(facade.selection.anchorId, undefined);
	});

	test('hostUpdated never overwrites an existing anchor', () => {
		const { facade } = setup('multi');
		facade.selection.setSingle('d'); // anchor <- 'd' via a real selection op
		facade.focus.focusIndex(0); // cursor moves to 'a'
		facade.hostUpdated();
		assert.strictEqual(facade.selection.anchorId, 'd'); // not re-seeded to the focus
	});

	test('hostUpdated re-seeds from the cursor after a clear', () => {
		const { facade } = setup('multi');
		facade.focus.focusIndex(0);
		facade.hostUpdated(); // anchor <- 'a'
		facade.selection.setSingle('c'); // anchor <- 'c'
		facade.selection.clear(); // anchor undefined
		facade.focus.focusIndex(3); // cursor now 'd'
		facade.hostUpdated();
		assert.strictEqual(facade.selection.anchorId, 'd');
	});

	test('hostUpdated does nothing when there is no focused row', () => {
		const { facade } = setup('multi');
		facade.hostUpdated();
		assert.strictEqual(facade.selection.anchorId, undefined);
	});
});
