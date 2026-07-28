import * as assert from 'assert';
import type { ScopeItem, ScopeItemState } from '../gl-commits-scope-pane.js';
import {
	getDefaultEnd,
	getDefaultStart,
	getMinEndIndex,
	resolveEndIndex,
	resolveSelectionRange,
	resolveStartIndex,
} from '../gl-commits-scope-pane.utils.js';

function item(id: string, state: ScopeItemState): ScopeItem {
	return { id: id, label: id, state: state };
}

const unstaged = item('unstaged', 'uncommitted');
const staged = item('staged', 'uncommitted');
const commitA = item('a', 'unpushed');
const commitB = item('b', 'pushed');
const mergeBase = item('merge-base:x', 'merge-base');
const loadMore = item('load-more', 'load-more');

suite('gl-commits-scope-pane range/floor utils', () => {
	suite('getMinEndIndex', () => {
		test('review mode never floors', () => {
			const items = [unstaged, staged, commitA];
			assert.strictEqual(getMinEndIndex('review', items, 0), 0);
		});

		test('compose with no unstaged row does not floor', () => {
			const items = [staged, commitA];
			assert.strictEqual(getMinEndIndex('compose', items, 0), 0);
		});

		test('compose does not floor when the start is below unstaged (unstaged excluded)', () => {
			const items = [unstaged, staged, commitA];
			// rangeStart at staged (1): unstaged is not in the selection, so no floor is imposed.
			assert.strictEqual(getMinEndIndex('compose', items, 1), 1);
		});

		test('compose floors the end down to staged when unstaged is included', () => {
			const items = [unstaged, staged, commitA];
			assert.strictEqual(getMinEndIndex('compose', items, 0), 1);
		});

		test('compose with unstaged but no staged row does not floor (unstaged-only is legitimate)', () => {
			const items = [unstaged, commitA];
			assert.strictEqual(getMinEndIndex('compose', items, 0), 0);
		});
	});

	suite('resolveEndIndex (the fix — floor applies to a derived range, not just interactive moves)', () => {
		test('compose: an end derived at unstaged is floored to staged when a staged row is present', () => {
			const items = [unstaged, staged, commitA, mergeBase];
			// This is the #5587 scenario: selection ended on `unstaged`, a `staged` row appeared under it.
			// Pre-fix this returned 0 (unstaged only, contradicting the floor); now it reconciles to staged.
			assert.strictEqual(resolveEndIndex('compose', items, 'unstaged', 0), 1);
		});

		test('compose: an end already at staged is unchanged', () => {
			const items = [unstaged, staged, commitA];
			assert.strictEqual(resolveEndIndex('compose', items, 'staged', 0), 1);
		});

		test('compose: unstaged end with no staged row stays at unstaged', () => {
			const items = [unstaged, commitA];
			assert.strictEqual(resolveEndIndex('compose', items, 'unstaged', 0), 0);
		});

		test('review: unstaged end is not floored even with a staged row present', () => {
			const items = [unstaged, staged, commitA];
			assert.strictEqual(resolveEndIndex('review', items, 'unstaged', 0), 0);
		});

		test('undefined end falls back to the default end (floor applied)', () => {
			const items = [unstaged, staged, commitA, mergeBase];
			// default end for WIP-present is the last WIP row (staged, index 1); floor is a no-op here.
			assert.strictEqual(resolveEndIndex('compose', items, undefined, 0), 1);
		});

		test('an end id that no longer resolves falls back to the default end', () => {
			const items = [unstaged, staged, commitA];
			assert.strictEqual(resolveEndIndex('compose', items, 'gone', 0), 1);
		});
	});

	suite('getDefaultStart', () => {
		test('starts at the first WIP row when WIP is present', () => {
			assert.strictEqual(getDefaultStart([commitB, unstaged, staged]), 1);
		});

		test('starts at 0 when there is no WIP row', () => {
			assert.strictEqual(getDefaultStart([commitA, commitB]), 0);
		});
	});

	suite('getDefaultEnd', () => {
		test('ends at the last WIP row when WIP is present', () => {
			assert.strictEqual(getDefaultEnd([unstaged, staged, commitA]), 1);
		});

		test('ends at the last unpushed row when no WIP but unpushed commits exist', () => {
			// pushed and merge-base/load-more rows are excluded from the unpushed end.
			assert.strictEqual(getDefaultEnd([commitA, commitB, loadMore, mergeBase]), 0);
		});

		test('ends at 0 when only pushed/footer rows exist', () => {
			assert.strictEqual(getDefaultEnd([commitB, mergeBase]), 0);
		});
	});

	suite('resolveStartIndex', () => {
		test('resolves a stored start id to its index', () => {
			assert.strictEqual(resolveStartIndex([unstaged, staged, commitA], 'staged'), 1);
		});

		test('falls back to the default start when the id is missing', () => {
			assert.strictEqual(resolveStartIndex([commitB, unstaged, staged], 'gone'), 1);
		});

		test('falls back to the default start when no id is given', () => {
			assert.strictEqual(resolveStartIndex([commitB, unstaged, staged], undefined), 1);
		});
	});

	suite('resolveSelectionRange', () => {
		test('undefined selection resolves to undefined', () => {
			assert.strictEqual(resolveSelectionRange([unstaged], undefined), undefined);
		});

		test('empty selection resolves to undefined', () => {
			assert.strictEqual(resolveSelectionRange([unstaged], []), undefined);
		});

		test('contiguous selection resolves to its first/last indices', () => {
			assert.deepStrictEqual(resolveSelectionRange([unstaged, staged, commitA], ['unstaged', 'staged']), {
				start: 0,
				end: 1,
			});
		});

		test('single-row selection resolves to a one-index range', () => {
			assert.deepStrictEqual(resolveSelectionRange([unstaged, staged, commitA], ['staged']), {
				start: 1,
				end: 1,
			});
		});

		test('sparse selection spans from the first to the last matching index', () => {
			assert.deepStrictEqual(resolveSelectionRange([unstaged, staged, commitA], ['unstaged', 'a']), {
				start: 0,
				end: 2,
			});
		});

		test('a scoped row that disappeared resolves to undefined', () => {
			// Repro of #5588: the picker was scoped unstaged-only, then everything was staged, so the
			// `unstaged` row no longer exists — the stored selection can no longer be honored.
			assert.strictEqual(resolveSelectionRange([staged, commitA], ['unstaged']), undefined);
		});

		test('a selection with no matching id resolves to undefined', () => {
			assert.strictEqual(resolveSelectionRange([staged], ['nope']), undefined);
		});

		test('a non-empty selection against empty items resolves to undefined', () => {
			// The picker distinguishes this "rows not loaded yet" case (empty items) from a genuine
			// row-disappeared miss (items present, none match) by guarding its reconcile on items.length.
			assert.strictEqual(resolveSelectionRange([], ['unstaged']), undefined);
		});
	});
});
