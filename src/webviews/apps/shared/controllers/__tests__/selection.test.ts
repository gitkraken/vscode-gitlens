import * as assert from 'assert';
import type { ReactiveControllerHost } from 'lit';
import type { SelectionMode } from '../selection.js';
import { SelectionController } from '../selection.js';

function fakeHost(): ReactiveControllerHost {
	return {
		addController: () => undefined,
		removeController: () => undefined,
		requestUpdate: () => undefined,
		updateComplete: Promise.resolve(true),
	};
}

function setup(options?: { mode?: SelectionMode; ordered?: string[]; isSelectable?: (id: string) => boolean }) {
	const ordered = options?.ordered ?? ['a', 'b', 'c', 'd', 'e'];
	let changes = 0;
	const controller = new SelectionController(fakeHost(), {
		mode: () => options?.mode ?? 'multi',
		orderedIds: () => ordered,
		isSelectable: options?.isSelectable,
		onChange: () => {
			changes++;
		},
	});
	return { controller: controller, ordered: ordered, getChanges: () => changes };
}

function ids(controller: SelectionController): string[] {
	return [...controller.selectedIds];
}

suite('SelectionController', () => {
	test('setSingle replaces selection and sets anchor', () => {
		const { controller } = setup();
		controller.setSingle('b');
		assert.deepStrictEqual(ids(controller), ['b']);
		assert.strictEqual(controller.anchorId, 'b');

		controller.setSingle('d');
		assert.deepStrictEqual(ids(controller), ['d']);
		assert.strictEqual(controller.anchorId, 'd');
	});

	test('toggle adds and removes, re-anchoring', () => {
		const { controller } = setup();
		controller.setSingle('b');
		controller.toggle('d');
		assert.deepStrictEqual(ids(controller).sort(), ['b', 'd']);
		assert.strictEqual(controller.anchorId, 'd');

		controller.toggle('b');
		assert.deepStrictEqual(ids(controller), ['d']);
	});

	test('selectRange selects contiguous range from the anchor', () => {
		const { controller } = setup();
		controller.setSingle('b');
		controller.selectRange('d');
		assert.deepStrictEqual(ids(controller).sort(), ['b', 'c', 'd']);
	});

	test('selectRange works backwards from the anchor', () => {
		const { controller } = setup();
		controller.setSingle('d');
		controller.selectRange('b');
		assert.deepStrictEqual(ids(controller).sort(), ['b', 'c', 'd']);
	});

	test('successive ranges re-pivot from the same anchor (replace, not grow)', () => {
		const { controller } = setup();
		controller.setSingle('b');
		controller.selectRange('d');
		controller.selectRange('a');
		assert.deepStrictEqual(ids(controller).sort(), ['a', 'b']);
	});

	test('additive range unions with the existing selection', () => {
		const { controller } = setup();
		controller.setSingle('a');
		controller.selectRange('a'); // anchor a, range {a}
		controller.toggle('c'); // {a,c}, anchor c
		controller.selectRange('e', { additive: true }); // union {c,d,e} with {a,c}
		assert.deepStrictEqual(ids(controller).sort(), ['a', 'c', 'd', 'e']);
	});

	test('setAnchor seeds the pivot without changing the selection set', () => {
		const { controller, getChanges } = setup();
		controller.setAnchor('c');
		assert.strictEqual(controller.anchorId, 'c');
		assert.deepStrictEqual(ids(controller), []);
		assert.strictEqual(getChanges(), 0); // pure pivot seed — no selection change emitted
	});

	test('a first selectRange ranges from a seeded anchor (no prior selection)', () => {
		// Repro of the load-time bug: with no anchor, selectRange falls back to the clicked id and
		// collapses to a single row. Seeding the anchor (from the initially focused row) makes the
		// very first Shift+click / Shift+Arrow produce a proper range.
		const { controller } = setup();
		controller.setAnchor('b'); // focused row on load
		controller.selectRange('d'); // first shift+click
		assert.deepStrictEqual(ids(controller).sort(), ['b', 'c', 'd']);
	});

	test('without a seeded anchor, a first selectRange collapses to the clicked row', () => {
		const { controller } = setup();
		controller.selectRange('d');
		assert.deepStrictEqual(ids(controller), ['d']);
	});

	test('selectAll selects every selectable id', () => {
		const { controller, ordered } = setup();
		controller.selectAll();
		assert.deepStrictEqual(ids(controller).sort(), ordered.toSorted());
	});

	test('isSelectable excludes ids from multi ops but not setSingle', () => {
		const { controller } = setup({ isSelectable: id => id !== 'c' });
		controller.setSingle('c'); // setSingle ignores selectability (single-select highlights folders)
		assert.deepStrictEqual(ids(controller), ['c']);

		controller.setSingle('b');
		controller.selectRange('d'); // c skipped
		assert.deepStrictEqual(ids(controller).sort(), ['b', 'd']);

		controller.toggle('c'); // no-op (not selectable)
		assert.deepStrictEqual(ids(controller).sort(), ['b', 'd']);

		controller.selectAll();
		assert.deepStrictEqual(ids(controller).sort(), ['a', 'b', 'd', 'e']);
	});

	test('clear empties the selection and anchor', () => {
		const { controller } = setup();
		controller.selectAll();
		controller.clear();
		assert.deepStrictEqual(ids(controller), []);
		assert.strictEqual(controller.anchorId, undefined);
	});

	test('pruneTo drops absent ids (Set form)', () => {
		const { controller } = setup();
		controller.setSingle('b');
		controller.toggle('c');
		controller.toggle('d');
		controller.pruneTo(new Set(['b', 'd']));
		assert.deepStrictEqual(ids(controller).sort(), ['b', 'd']);
	});

	test('pruneTo drops absent ids (predicate form) and clears a removed anchor', () => {
		const { controller } = setup();
		controller.setSingle('a');
		controller.toggle('e'); // anchor is now 'e', selection {a, e}
		controller.pruneTo(id => id === 'a'); // keep only 'a'; the anchor 'e' is removed
		assert.deepStrictEqual(ids(controller), ['a']);
		assert.strictEqual(controller.anchorId, undefined);
	});

	test('pruneTo keeps a surviving anchor', () => {
		const { controller } = setup();
		controller.setSingle('a');
		controller.toggle('e'); // anchor 'e', selection {a, e}
		controller.pruneTo(id => id === 'e'); // keep only 'e'; anchor survives
		assert.deepStrictEqual(ids(controller), ['e']);
		assert.strictEqual(controller.anchorId, 'e');
	});

	test('onChange fires on every mutation', () => {
		const { controller, getChanges } = setup();
		controller.setSingle('a');
		controller.toggle('b');
		controller.clear();
		assert.strictEqual(getChanges(), 3);
	});

	test('single mode replaces on setSingle', () => {
		const { controller } = setup({ mode: 'single' });
		assert.strictEqual(controller.mode, 'single');
		controller.setSingle('a');
		controller.setSingle('b');
		assert.deepStrictEqual(ids(controller), ['b']);
	});
});
