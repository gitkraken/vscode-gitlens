import * as assert from 'assert';
import { SelectionController } from '../../../controllers/selection.js';
import { GlTreeView } from '../tree-view.js';

/** Minimal `this` for {@link GlTreeView.willUpdate} applying a `focusedPath` hint — the cursor, the
 *  selection and the pending scroll it moves, over a flat list of rows. A row in `collapsed` is in the
 *  model but hidden under a collapsed folder; `rows` is what the model holds. */
type FocusHintHarness = {
	focusedPath?: string;
	focusedPathOnly: boolean;
	multiSelectable: boolean;
	_selection: SelectionController;
	_index: { indexOf(path: string): number; has(path: string): boolean };
	_focusedItemPath?: string;
	_focusedItemIndex: number;
	_lastSelectedPath?: string;
	_pendingScrollToIndex?: number;
	_appliedFocusHint?: string;
	_model?: unknown;
	rows: string[];
	collapsed: Set<string>;
	expanded: string[];
	expandAncestorsOf(path: string): boolean;
	modelHolds(path: string): boolean;
};

const willUpdate: (this: FocusHintHarness, changedProperties: Map<PropertyKey, unknown>) => void = Reflect.get(
	GlTreeView.prototype,
	'willUpdate',
);

const rows = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'];

function createTree(options: {
	selected: string[];
	cursor?: string;
	focusedPathOnly?: boolean;
	rows?: string[];
}): FocusHintHarness {
	const tree: FocusHintHarness = {
		focusedPathOnly: options.focusedPathOnly ?? false,
		multiSelectable: true,
		_selection: new SelectionController(
			{ addController: () => {} } as unknown as ConstructorParameters<typeof SelectionController>[0],
			{ mode: () => 'multi', orderedIds: () => tree.rows },
		),
		_index: {
			indexOf: path => (tree.collapsed.has(path) ? -1 : tree.rows.indexOf(path)),
			has: path => !tree.collapsed.has(path) && tree.rows.includes(path),
		},
		_focusedItemPath: options.cursor,
		_focusedItemIndex: options.cursor != null ? rows.indexOf(options.cursor) : -1,
		rows: options.rows ?? rows,
		collapsed: new Set(),
		expanded: [],
		expandAncestorsOf: function (path) {
			this.expanded.push(path);
			return this.collapsed.delete(path);
		},
		modelHolds: function (path) {
			return this.rows.includes(path);
		},
	};
	// The real decisions, not copies of them
	for (const name of ['holdsReaderSelection', 'focusHintApplied']) {
		Object.defineProperty(tree, name, Object.getOwnPropertyDescriptor(GlTreeView.prototype, name)!);
	}
	for (const path of options.selected) {
		tree._selection.toggle(path);
	}
	return tree;
}

function follow(tree: FocusHintHarness, path: string): void {
	const prev = tree.focusedPath;
	tree.focusedPath = path;
	willUpdate.call(tree, new Map([['focusedPath', prev]]));
}

/** A model rebuild under an unchanged hint — a checkbox toggled, a refresh, files arriving. */
function rebuild(tree: FocusHintHarness, rows?: string[]): void {
	if (rows != null) {
		tree.rows = rows;
	}
	willUpdate.call(tree, new Map([['model', undefined]]));
}

suite('tree/tree-view focused-path hint', () => {
	test('with nothing selected, selects the hinted row, moves the cursor there and scrolls to it', () => {
		const tree = createTree({ selected: [], cursor: 'src/a.ts' });

		follow(tree, 'src/c.ts');

		assert.deepStrictEqual([...tree._selection.selectedIds], ['src/c.ts']);
		assert.strictEqual(tree._focusedItemPath, 'src/c.ts');
		assert.strictEqual(tree._focusedItemIndex, 2);
		assert.strictEqual(tree._pendingScrollToIndex, 2);
	});

	test('with one row selected, replaces it with the hinted row and moves the cursor there', () => {
		const tree = createTree({ selected: ['src/a.ts'], cursor: 'src/a.ts' });

		follow(tree, 'src/d.ts');

		assert.deepStrictEqual([...tree._selection.selectedIds], ['src/d.ts']);
		assert.strictEqual(tree._focusedItemPath, 'src/d.ts');
		assert.strictEqual(tree._pendingScrollToIndex, 3);
	});

	test("with several rows selected, only scrolls to the hinted row — the reader's selection and cursor stay", () => {
		// Following the active diff used to collapse a multi-selection to the followed file and move the
		// cursor there, so Space then toggled the followed file's checkbox instead of the reader's row
		const tree = createTree({ selected: ['src/a.ts', 'src/b.ts'], cursor: 'src/b.ts' });

		follow(tree, 'src/d.ts');

		assert.deepStrictEqual([...tree._selection.selectedIds].sort(), ['src/a.ts', 'src/b.ts']);
		assert.strictEqual(tree._focusedItemPath, 'src/b.ts');
		assert.strictEqual(tree._focusedItemIndex, 1);
		assert.strictEqual(tree._pendingScrollToIndex, 3);
		assert.deepStrictEqual(tree.expanded, ['src/d.ts'], 'opens the way to a row under a collapsed folder');
	});

	test('with several rows selected, a model rebuild neither moves anything nor scrolls', () => {
		// Toggling a checkbox rebuilds the model; re-applying the hint would yank the scroll to the followed
		// file while the reader works on their selection
		const tree = createTree({ selected: ['src/a.ts', 'src/b.ts'], cursor: 'src/b.ts' });
		follow(tree, 'src/d.ts');
		tree.expanded.length = 0;
		tree._pendingScrollToIndex = undefined;

		rebuild(tree);

		assert.deepStrictEqual([...tree._selection.selectedIds].sort(), ['src/a.ts', 'src/b.ts']);
		assert.strictEqual(tree._focusedItemPath, 'src/b.ts');
		assert.strictEqual(tree._pendingScrollToIndex, undefined);
		assert.deepStrictEqual(tree.expanded, []);
	});

	test("with several rows selected, a hint for another tree's row keeps the selection", () => {
		// The reading plan's panes share the hint and each clears its selection when the row isn't theirs —
		// except a pane the reader has picked several rows in
		const tree = createTree({ selected: ['src/a.ts', 'src/b.ts'], cursor: 'src/b.ts', focusedPathOnly: true });

		follow(tree, 'other/x.ts');

		assert.deepStrictEqual([...tree._selection.selectedIds].sort(), ['src/a.ts', 'src/b.ts']);
		assert.strictEqual(tree._focusedItemPath, 'src/b.ts');
		assert.strictEqual(tree._pendingScrollToIndex, undefined);
	});

	test("with one row selected, a hint for another tree's row clears it", () => {
		const tree = createTree({ selected: ['src/a.ts'], cursor: 'src/a.ts', focusedPathOnly: true });

		follow(tree, 'other/x.ts');

		assert.strictEqual(tree._selection.selectedIds.size, 0);
		assert.strictEqual(tree._focusedItemPath, undefined);
	});

	test('the first model with a hint opens the folders above its row, selects it and scrolls to it', () => {
		const tree = createTree({ selected: [] });
		tree.collapsed.add('src/c.ts');
		tree.focusedPath = 'src/c.ts';

		rebuild(tree);

		assert.deepStrictEqual(tree.expanded, ['src/c.ts']);
		assert.deepStrictEqual([...tree._selection.selectedIds], ['src/c.ts']);
		assert.strictEqual(tree._focusedItemPath, 'src/c.ts');
		assert.strictEqual(tree._pendingScrollToIndex, 2);
	});

	test('a model rebuild under the same hint keeps a folder the reader collapsed, and their selection', () => {
		// Collapsing the folder of the followed file and then toggling a checkbox (which rebuilds the model)
		// used to open the folder again and pull the selection and cursor back to the followed file
		const tree = createTree({ selected: [], cursor: 'src/a.ts' });
		follow(tree, 'src/c.ts');
		tree.expanded.length = 0;
		tree._pendingScrollToIndex = undefined;

		tree.collapsed.add('src/c.ts');
		tree._selection.setSingle('src/a.ts');
		tree._focusedItemPath = 'src/a.ts';
		tree._focusedItemIndex = 0;
		rebuild(tree);

		assert.deepStrictEqual(tree.expanded, []);
		assert.ok(tree.collapsed.has('src/c.ts'), 'the folder stays collapsed');
		assert.deepStrictEqual([...tree._selection.selectedIds], ['src/a.ts']);
		assert.strictEqual(tree._focusedItemPath, 'src/a.ts');
		assert.strictEqual(tree._pendingScrollToIndex, undefined);
	});

	test('a hint set before its row is in the model applies once the row turns up', () => {
		// The review can follow the active diff before the files have loaded
		const tree = createTree({ selected: [], rows: [] });
		tree.focusedPath = 'src/c.ts';
		rebuild(tree);

		assert.strictEqual(tree._selection.selectedIds.size, 0);
		assert.strictEqual(tree._pendingScrollToIndex, undefined);

		tree.collapsed.add('src/c.ts');
		rebuild(tree, rows);

		assert.deepStrictEqual(tree.expanded, ['src/c.ts', 'src/c.ts']);
		assert.ok(!tree.collapsed.has('src/c.ts'));
		assert.deepStrictEqual([...tree._selection.selectedIds], ['src/c.ts']);
		assert.strictEqual(tree._focusedItemPath, 'src/c.ts');
		assert.strictEqual(tree._pendingScrollToIndex, 2);
	});

	test('a hint whose row left the model applies again when the row comes back', () => {
		const tree = createTree({ selected: [], cursor: 'src/a.ts' });
		follow(tree, 'src/c.ts');
		rebuild(tree, ['src/a.ts', 'src/b.ts']);
		tree._selection.setSingle('src/a.ts');
		tree._pendingScrollToIndex = undefined;

		rebuild(tree, rows);

		assert.deepStrictEqual([...tree._selection.selectedIds], ['src/c.ts']);
		assert.strictEqual(tree._pendingScrollToIndex, 2);
	});
});
