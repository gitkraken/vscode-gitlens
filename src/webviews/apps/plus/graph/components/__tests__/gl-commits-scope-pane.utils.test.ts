import * as assert from 'assert';
import type { ScopeItem, ScopeItemState } from '../gl-commits-scope-pane.js';
import {
	getDefaultEnd,
	getDefaultStart,
	getMinEndIndex,
	getScopePresets,
	isSameScopeSelection,
	rangeMovedWithRows,
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

	suite('rangeMovedWithRows', () => {
		const tipBefore = item('old-tip', 'pushed');
		const tipAfter = item('new-tip', 'pushed');
		const range = (start: string, end: string) => ({ start: start, end: end });

		test('a rewrite that re-pins the range onto new commits moves it', () => {
			// The branch went from many commits to a few, and the scope followed its tip onto the new
			// one: the old scroll position means nothing on the new list.
			const before = [tipBefore, commitA, commitB, item('c', 'pushed'), item('d', 'pushed'), mergeBase];
			const after = [tipAfter, commitB, mergeBase];
			assert.strictEqual(
				rangeMovedWithRows(before, after, range('old-tip', 'old-tip'), range('new-tip', 'new-tip')),
				true,
			);
		});

		test('a commit added under a range that takes it in moves it', () => {
			const before = [commitA, commitB, mergeBase];
			const after = [tipAfter, commitA, commitB, mergeBase];
			assert.strictEqual(rangeMovedWithRows(before, after, range('a', 'b'), range('new-tip', 'b')), true);
		});

		test('a list change that leaves the range on the same rows keeps the viewport', () => {
			// A working-changes tick adds the staged row above a range of commits.
			const before = [commitA, commitB, mergeBase];
			const after = [staged, commitA, commitB, mergeBase];
			assert.strictEqual(rangeMovedWithRows(before, after, range('a', 'b'), range('a', 'b')), false);
		});

		test('a range moved on an unchanged list keeps the viewport', () => {
			// The reader dragged a handle: the rows are the same, so they are looking where they want.
			const rows = [commitA, commitB, mergeBase];
			const sameRows = [commitA, commitB, mergeBase];
			assert.strictEqual(rangeMovedWithRows(rows, sameRows, range('a', 'a'), range('a', 'b')), false);
		});

		test('the first load and an empty list are left to the caller', () => {
			const rows = [commitA, mergeBase];
			assert.strictEqual(rangeMovedWithRows(undefined, rows, undefined, range('a', 'a')), false);
			assert.strictEqual(rangeMovedWithRows([], rows, undefined, range('a', 'a')), false);
			assert.strictEqual(rangeMovedWithRows(rows, [], range('a', 'a'), undefined), false);
		});
	});
});

suite('getScopePresets', () => {
	const wip = [unstaged, staged];
	const pushed = (id: string) => item(id, 'pushed');
	const unpushed = (id: string) => item(id, 'unpushed');

	function presets(items: ScopeItem[], includeShas: string[] = [], includeUncommitted = true) {
		const selected = [...(includeUncommitted ? ['unstaged', 'staged'] : []), ...includeShas];
		return getScopePresets(items).map(p => [p.key, isSameScopeSelection(p.ids, selected)]);
	}

	test('offers the uncommitted changes, the unpushed commits with them, and the whole branch', () => {
		const items = [...wip, unpushed('c3'), pushed('c2'), pushed('c1'), loadMore, mergeBase];
		assert.deepStrictEqual(presets(items), [
			['uncommitted', true],
			['unpushed', false],
			['branch', false],
		]);
		assert.deepStrictEqual(
			presets(items, ['c3', 'c2', 'c1']).map(([, pressed]) => pressed),
			[false, false, true],
		);
	});

	test('leaves out a preset that picks what another does, and shows nothing when there is no choice', () => {
		const withoutUpstream = [...wip, unpushed('c2'), unpushed('c1'), mergeBase];
		assert.deepStrictEqual(
			presets(withoutUpstream).map(([key]) => key),
			['uncommitted', 'branch'],
		);

		const withoutMergeBase = [...wip, unpushed('c2'), pushed('c1'), loadMore];
		assert.deepStrictEqual(
			presets(withoutMergeBase).map(([key]) => key),
			['uncommitted', 'unpushed'],
		);

		assert.deepStrictEqual(presets([...wip]), []);
	});

	test('shows a lone Branch preset on a pushed branch with a clean tree', () => {
		const items = [pushed('c2'), pushed('c1'), loadMore, mergeBase];
		assert.deepStrictEqual(presets(items, ['c2'], false), [['branch', false]]);
		assert.deepStrictEqual(presets(items, ['c2', 'c1'], false), [['branch', true]]);
	});

	test('keeps Branch to the commits above the merge base once Load more lists it', () => {
		const items = [pushed('c2'), pushed('c1'), { ...pushed('m2'), mergeBase: true }, pushed('m1')];
		assert.deepStrictEqual(presets(items, ['c2', 'c1', 'm2'], false), [['branch', false]]);
		assert.deepStrictEqual(presets(items, ['c2', 'c1'], false), [['branch', true]]);
	});
});
