import * as assert from 'assert';
import type { ReactiveControllerHost } from 'lit';
import { CollectionIndexController } from '../collection-index.js';
import { FocusController } from '../focus.js';
import { KeyboardNavController } from '../keyboard-nav.js';
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

function key(k: string, mods?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }): KeyboardEvent {
	const event = {
		key: k,
		shiftKey: mods?.shiftKey ?? false,
		ctrlKey: mods?.ctrlKey ?? false,
		metaKey: mods?.metaKey ?? false,
	};
	return event as unknown as KeyboardEvent;
}

function setup(mode: SelectionMode = 'multi') {
	const items = ['a', 'b', 'c', 'd', 'e'].map(p => ({ path: p }));
	const host = fakeHost();
	const index = new CollectionIndexController(host, { getItems: () => items, getItemId: r => r.path });
	index.rebuild();
	const focus = new FocusController(host, { index: index });
	const selection = new SelectionController(host, { mode: () => mode, orderedIds: () => index.ids() });

	const activated: string[] = [];
	const unhandled: string[] = [];
	const keyboard = new KeyboardNavController(host, {
		index: index,
		focus: focus,
		selection: selection,
		mode: () => mode,
		onActivate: id => activated.push(id),
		onUnhandledKey: e => {
			unhandled.push(e.key);
			return true;
		},
	});

	return {
		focus: focus,
		selection: selection,
		keyboard: keyboard,
		activated: activated,
		unhandled: unhandled,
		selectedIds: () => [...selection.selectedIds].sort(),
	};
}

suite('KeyboardNavController', () => {
	test('ArrowDown moves focus and selection follows (single collapse)', () => {
		const { focus, keyboard, selectedIds } = setup();
		focus.focusIndex(0); // 'a'
		const handled = keyboard.handleKeydown(key('ArrowDown'));
		assert.strictEqual(handled, true);
		assert.strictEqual(focus.focusedId, 'b');
		assert.deepStrictEqual(selectedIds(), ['b']);
	});

	test('Shift+ArrowDown extends the range from the anchor (multi)', () => {
		const { focus, selection, keyboard, selectedIds } = setup('multi');
		selection.setSingle('b'); // anchor b
		focus.focusIndex(1); // 'b'
		keyboard.handleKeydown(key('ArrowDown', { shiftKey: true })); // -> c, range b..c
		assert.strictEqual(focus.focusedId, 'c');
		assert.deepStrictEqual(selectedIds(), ['b', 'c']);
	});

	test('Ctrl+ArrowDown moves focus without changing selection (multi)', () => {
		const { focus, selection, keyboard, selectedIds } = setup('multi');
		selection.setSingle('b');
		focus.focusIndex(1);
		keyboard.handleKeydown(key('ArrowDown', { ctrlKey: true })); // -> c, selection unchanged
		assert.strictEqual(focus.focusedId, 'c');
		assert.deepStrictEqual(selectedIds(), ['b']);
	});

	test('Enter activates the focused id', () => {
		const { focus, keyboard, activated } = setup();
		focus.focusIndex(2); // 'c'
		keyboard.handleKeydown(key('Enter'));
		assert.deepStrictEqual(activated, ['c']);
	});

	test('Space toggles in multi mode', () => {
		const { focus, keyboard, selectedIds } = setup('multi');
		focus.focusIndex(2); // 'c'
		keyboard.handleKeydown(key(' '));
		assert.deepStrictEqual(selectedIds(), ['c']);
		keyboard.handleKeydown(key(' '));
		assert.deepStrictEqual(selectedIds(), []);
	});

	test('Space activates in single mode', () => {
		const { focus, keyboard, activated } = setup('single');
		focus.focusIndex(1); // 'b'
		keyboard.handleKeydown(key(' '));
		assert.deepStrictEqual(activated, ['b']);
	});

	test('Ctrl+A selects all in multi mode', () => {
		const { keyboard, selectedIds } = setup('multi');
		const handled = keyboard.handleKeydown(key('a', { ctrlKey: true }));
		assert.strictEqual(handled, true);
		assert.deepStrictEqual(selectedIds(), ['a', 'b', 'c', 'd', 'e']);
	});

	test('Home/End jump to first/last', () => {
		const { focus, keyboard } = setup();
		focus.focusIndex(2);
		keyboard.handleKeydown(key('End'));
		assert.strictEqual(focus.focusedId, 'e');
		keyboard.handleKeydown(key('Home'));
		assert.strictEqual(focus.focusedId, 'a');
	});

	test('unrecognized keys are forwarded to the seam', () => {
		const { keyboard, unhandled } = setup();
		const handled = keyboard.handleKeydown(key('ArrowLeft'));
		assert.strictEqual(handled, true); // host reported handled
		assert.deepStrictEqual(unhandled, ['ArrowLeft']);
	});

	test('plain "a" (no ctrl) is forwarded, not select-all', () => {
		const { keyboard, unhandled, selectedIds } = setup('multi');
		keyboard.handleKeydown(key('a'));
		assert.deepStrictEqual(unhandled, ['a']);
		assert.deepStrictEqual(selectedIds(), []);
	});

	function setupWithUnselectable(mode: SelectionMode) {
		const items = ['a', 'b', 'folder', 'd'].map(p => ({ path: p }));
		const host = fakeHost();
		const index = new CollectionIndexController(host, { getItems: () => items, getItemId: r => r.path });
		index.rebuild();
		const focus = new FocusController(host, { index: index });
		const selection = new SelectionController(host, {
			mode: () => mode,
			orderedIds: () => index.ids(),
			isSelectable: id => id !== 'folder',
		});
		const keyboard = new KeyboardNavController(host, {
			index: index,
			focus: focus,
			selection: selection,
			mode: () => mode,
		});
		return { focus: focus, selection: selection, keyboard: keyboard };
	}

	test('multi-mode plain arrow onto a non-selectable row keeps the selection (folder guard)', () => {
		const { focus, selection, keyboard } = setupWithUnselectable('multi');
		selection.setSingle('b');
		focus.focusIndex(1); // 'b'
		keyboard.handleKeydown(key('ArrowDown')); // -> 'folder' (non-selectable)
		assert.strictEqual(focus.focusedId, 'folder'); // cursor still moves
		assert.deepStrictEqual([...selection.selectedIds], ['b']); // selection NOT collapsed onto the folder
	});

	test('single-mode arrow onto a non-selectable row still highlights it (no guard in single)', () => {
		const { focus, selection, keyboard } = setupWithUnselectable('single');
		focus.focusIndex(1); // 'b'
		keyboard.handleKeydown(key('ArrowDown')); // -> 'folder'
		assert.strictEqual(focus.focusedId, 'folder');
		assert.deepStrictEqual([...selection.selectedIds], ['folder']); // single mode highlights folders
	});
});
