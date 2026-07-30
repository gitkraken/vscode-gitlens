import * as assert from 'assert';
import type { ProcessedGraphRow, Sha } from '../engine/types.js';
import type { FocalScope } from '../scope.js';
import { computeInScopeShas, computeScopeAnchors, computeScopeProjection } from '../scope.js';

// Shared fixture: `feature` rebased onto `main`, newest -> oldest.
//   F2 -> F1 -> M3 (main tip) -> M2 -> M1 -> M0
const parentsBySha: Record<Sha, Sha[]> = {
	F2: ['F1'],
	F1: ['M3'],
	M3: ['M2'],
	M2: ['M1'],
	M1: ['M0'],
	M0: [],
};
const shas = Object.keys(parentsBySha);

/** Host row shape: the scope math's minimum (sha + parents) plus the ref metadata the injected
 *  heads predicate reads — the engine never sees `heads` itself. */
interface HostRow {
	sha: Sha;
	parents: Sha[];
	heads?: { id: string; name: string; isCurrentHead: boolean }[];
}

const rows: HostRow[] = shas.map(sha => ({
	sha: sha,
	parents: parentsBySha[sha],
	heads:
		sha === 'F2'
			? [{ id: 'h-feature', name: 'feature', isCurrentHead: true }]
			: sha === 'M3'
				? [{ id: 'h-main', name: 'main', isCurrentHead: false }]
				: undefined,
}));

const hasHead = (row: HostRow, branchName: string): boolean => row.heads?.some(h => h.name === branchName) ?? false;

const processedRows: ProcessedGraphRow[] = shas.map(sha => ({
	sha: sha,
	parents: parentsBySha[sha],
	kind: 'commit',
	column: sha.startsWith('F') ? 1 : 0,
	edges: {},
	edgeColumnMax: 0,
}));

/** Host scope shape: the scope math's minimum plus the extra fields a consumer carries — the math
 *  reads only the minimum, so any superset works. */
interface HostScope extends FocalScope {
	branchRef: string;
	mergeBase?: { sha: Sha; date: number };
}

function scopeTo(mergeBaseSha: Sha | undefined, mergeTargetTipSha: Sha | undefined): HostScope {
	return {
		branchName: 'feature',
		branchRef: '/repo|heads/feature',
		...(mergeBaseSha != null ? { mergeBase: { sha: mergeBaseSha, date: 1 } } : undefined),
		...(mergeTargetTipSha != null ? { mergeTargetTipSha: mergeTargetTipSha } : undefined),
	};
}

function project(scope: HostScope) {
	const anchors = computeScopeAnchors(rows, scope, hasHead);
	const projection = computeScopeProjection(processedRows, scope, anchors, new Set());
	return {
		anchors: anchors,
		projection: projection,
		visible: shas.filter(sha => projection == null || !projection.dropped.has(sha)),
	};
}

/** Same fixture with a WIP row on top, anchored at `parentSha` — the consumer synthesizes this row
 *  client-side, so it reaches the projection like any other row. */
function projectWithWip(scope: HostScope, parentSha: Sha) {
	const wipRowId = 'wip::/repo';
	const wipRows: ProcessedGraphRow[] = [
		{ sha: wipRowId, parents: [parentSha], kind: 'workdir', column: 1, edges: {}, edgeColumnMax: 0 },
		...processedRows,
	];
	const projection = computeScopeProjection(wipRows, scope, computeScopeAnchors(rows, scope, hasHead), new Set());
	return {
		projection: projection,
		wipVisible: projection == null || !projection.dropped.has(wipRowId),
	};
}

suite('computeScopeAnchors + computeScopeProjection', () => {
	test('anchors resolved against the current history mark the fork point and bound the spine at it', () => {
		const { anchors, projection, visible } = project(scopeTo('M3', 'M3'));

		assert.deepStrictEqual([...(anchors.focalTipShas ?? [])], ['F2']);
		assert.deepStrictEqual([...(anchors.forkPointShas ?? [])], ['M3']);
		assert.deepStrictEqual([...(anchors.mergeTargetShas ?? [])], ['M3']);
		assert.strictEqual(anchors.unreachableAnchors, undefined);
		// Focal spine = the branch's commits + the fork point; older history folds into one stub.
		assert.deepStrictEqual(visible, ['F2', 'F1', 'M3', 'M2']);
		assert.deepStrictEqual([...(projection?.foldSegments.keys() ?? [])], ['M2']);
	});

	test('anchors left behind by a history rewrite mark ordinary trunk commits and swallow trunk into the spine', () => {
		// Why the live scope's anchors must never survive a rebase (see `isScopeAnchorStale` in
		// `stateProvider.ts`): they're SHAs, so a pre-rebase merge base / merge-target tip stay loaded
		// as ordinary trunk commits. Nothing downstream can tell they're obsolete — the fork-point and
		// merge-target markers land on them, and the spine walk runs past the real fork point down to
		// the stale one, dragging trunk history into the "scoped to this branch" view.
		const { anchors, visible } = project(scopeTo('M1', 'M2'));

		assert.deepStrictEqual([...(anchors.forkPointShas ?? [])], ['M1']);
		assert.deepStrictEqual([...(anchors.mergeTargetShas ?? [])], ['M2']);
		assert.deepStrictEqual(visible, ['F2', 'F1', 'M3', 'M2', 'M1', 'M0']);
	});

	test('the WIP row survives when anchored at the focal tip', () => {
		// `getDecoratedRows` resolves the WIP row's anchor by the `isCurrentHead` flag while the spine
		// walk resolves the focal tip by branch NAME. They must land on the same row — this pins the
		// case where they agree, which is the only one the projection keeps.
		const { wipVisible } = projectWithWip(scopeTo('M3', 'M3'), 'F2');
		assert.strictEqual(wipVisible, true);
	});

	test('the WIP row is dropped when anchored off the focal spine', () => {
		// The failure this guards: with no `isCurrentHead` row loaded, `getDecoratedRows` used to fall
		// back to `realRows[0]`, which under scope is often the merge-target tip — inside the fold, not
		// on the spine — and the row silently vanished. The projection genuinely can't keep it there;
		// the fix is upstream (anchor on the same row the spine is rooted at), so pin the drop.
		const { wipVisible } = projectWithWip(scopeTo('M3', 'M3'), 'M2');
		assert.strictEqual(wipVisible, false);
	});

	test('a merge base outside the loaded rows is surfaced as unreachable (drives the targeted page)', () => {
		// The paging path (`onScopeAnchorsUnreachable` -> `pickScopePageTarget`) keys off this, which is
		// what lets `patchScopeAnchor` apply a fresh-but-unloaded merge base instead of keeping a stale one.
		const { anchors } = project(scopeTo('M9', 'M3'));

		assert.strictEqual(anchors.forkPointShas, undefined);
		assert.deepStrictEqual([...(anchors.unreachableAnchors ?? [])], ['M9']);
	});

	test('an unloaded merge base still re-roots, bounded by the merge target line (open terminus)', () => {
		// A stale branch's merge base sits outside the loaded window. The tip is the start and the base is
		// merely late, so the view re-roots immediately, bounded at the merge target's own first-parent line
		// (shared history = at or below the fork point) rather than at the missing base.
		const { projection, visible } = project(scopeTo('M9', 'M3'));

		assert.notStrictEqual(projection, undefined);
		// F2/F1 = the branch's own commits; M3 = the merge-target fold's stub. Trunk is NOT in the spine.
		assert.deepStrictEqual(visible, ['F2', 'F1', 'M3']);
		assert.deepStrictEqual([...(projection?.foldSegments.keys() ?? [])], ['M3']);
		// No older-history fold: the base bounds it, and nothing below an unloaded base is loaded.
		assert.strictEqual(projection?.hiddenCountByTipSha.get('M3'), 3);
	});

	test('an unloaded merge base with no loaded merge target does NOT re-root', () => {
		// Nothing stands in for the boundary here, so the first-parent walk runs to the root commit with
		// no boundary in sight — evidence the resolved base isn't on this line at all (a SHA a rewrite
		// left behind) rather than merely late. Re-rooting would present trunk as the branch's spine.
		const { projection } = project(scopeTo('M9', 'M8'));

		assert.strictEqual(projection, undefined);
	});

	test('an unloaded merge base whose focal tip sits on the merge target line keeps the tip', () => {
		// Two branches on one commit: the tip is itself on the target's first-parent line, so the boundary
		// stand-in matches on the very first step. The tip must still make it into the spine — an empty
		// spine would drop every row and blank the graph.
		// `feature` MOVED onto the trunk tip (not duplicated) — the anchors resolve the focal tip by taking
		// the first row carrying the head, so leaving one on F2 would just resolve F2.
		const tipOnTrunk: HostRow[] = rows.map(r => {
			if (r.sha === 'F2') return { ...r, heads: undefined };
			if (r.sha === 'M3') {
				return { ...r, heads: [{ id: 'h-feature', name: 'feature', isCurrentHead: true }] };
			}
			return r;
		});
		const scope = scopeTo('M9', 'M3');
		const anchors = computeScopeAnchors(tipOnTrunk, scope, hasHead);
		const projection = computeScopeProjection(processedRows, scope, anchors, new Set());

		assert.deepStrictEqual([...(anchors.focalTipShas ?? [])], ['M3']);
		assert.notStrictEqual(projection, undefined);
		assert.strictEqual(projection?.dropped.has('M3'), false);
	});

	test('a merge base the anchors resolved but the engine rows lack is bounded like an open terminus', () => {
		// The anchors are computed over the CONSUMER's rows; the projection sees the engine's, which
		// ref-visibility and stash filtering have already narrowed. So `forkPointShas` can name a base these
		// rows don't carry. Resolving the bound against the projection's own rows is what keeps the spine off
		// trunk — an index bound that falls back to `rows.length` is inert and the walk runs straight past.
		const scope = scopeTo('M1', 'M3');
		const anchors = computeScopeAnchors(rows, scope, hasHead);
		const engineRows = processedRows.filter(r => r.sha !== 'M1');
		const projection = computeScopeProjection(engineRows, scope, anchors, new Set());

		assert.deepStrictEqual([...(anchors.forkPointShas ?? [])], ['M1']);
		assert.notStrictEqual(projection, undefined);
		// Bounded at the merge-target line: F2/F1 are the branch's own, M3 is the fold stub. M2 must NOT be
		// dragged into the spine.
		assert.strictEqual(projection?.dropped.has('M2'), true);
		assert.strictEqual(projection?.dropped.has('F1'), false);
		assert.deepStrictEqual([...(projection?.foldSegments.keys() ?? [])], ['M3']);
	});

	test('a scope with no merge base at all does NOT re-root', () => {
		// Distinct in kind from the open terminus above: git has already answered "no boundary exists"
		// (default branch / no merge target), so paging can never produce one and an open-ended spine
		// would grow deeper into trunk with every page. Stays on dim-in-place.
		const { projection } = project(scopeTo(undefined, 'M3'));

		assert.strictEqual(projection, undefined);
	});
});

suite('computeInScopeShas', () => {
	const inScope = (scope: HostScope) => {
		const anchors = computeScopeAnchors(rows, scope, hasHead);
		return computeInScopeShas(rows, scope, anchors.focalTipShas, anchors.mergeTargetShas, anchors.forkPointShas);
	};

	test('walks the focal + merge-target first-parent chains when the base is loaded', () => {
		assert.deepStrictEqual([...(inScope(scopeTo('M3', 'M3')) ?? [])], ['F2', 'F1', 'M3', 'M2', 'M1', 'M0']);
	});

	test('returns undefined while an unloaded merge base cuts the chain at the window edge', () => {
		// The original bug's shape: the branch's own line points at the unloaded base, so the walk
		// truncates after the branch's own commits and would dim essentially every other row on screen.
		// `computeScopeProjection` re-roots this case itself; this covers lane folding turned off, where
		// dimming is the only scope treatment.
		const stale: HostRow[] = rows.map(r => (r.sha === 'F1' ? { ...r, parents: ['M9'] } : r));
		const scope = scopeTo('M9', 'M3');
		const anchors = computeScopeAnchors(stale, scope, hasHead);

		assert.strictEqual(
			computeInScopeShas(stale, scope, anchors.focalTipShas, anchors.mergeTargetShas, anchors.forkPointShas),
			undefined,
		);
	});

	test('keeps the chain for an unloaded merge base once the loaded lines bottom out at a root', () => {
		// The walk ran to M0 with no window edge left for the base to hide below — the resolved base isn't
		// on these lines at all (a rewrite leftover), so the lineage is as complete as it will ever get and
		// the scope keeps the same dim a no-base scope gets. This is also the shape the projection's
		// bounded-spine bail (no loaded merge target — see 'does NOT re-root' above) falls back to, so
		// suppressing it here would leave that scope with no treatment at all.
		assert.deepStrictEqual([...(inScope(scopeTo('M9', 'M8')) ?? [])], ['F2', 'F1', 'M3', 'M2', 'M1', 'M0']);
	});

	test('keeps the chain for a scope with no resolved merge base', () => {
		// No boundary to wait for, so the focal lineage is the best answer available — unchanged behavior.
		assert.deepStrictEqual(
			[...(inScope(scopeTo(undefined, undefined)) ?? [])],
			['F2', 'F1', 'M3', 'M2', 'M1', 'M0'],
		);
	});

	test('returns undefined when the focal branch tip is not loaded', () => {
		// An unresolved focal branch reports as an absent `focalTipShas` and must NOT enter
		// `unreachableAnchors`: consumers page that set by SHA, and a `branch:<name>` marker sent as a page
		// target made the host walk history for a SHA that can never match, to its defensive cap.
		const withoutTip = rows.filter(r => r.sha !== 'F2');
		const scope = scopeTo('M3', 'M3');
		const anchors = computeScopeAnchors(withoutTip, scope, hasHead);

		assert.strictEqual(anchors.focalTipShas, undefined);
		assert.strictEqual(anchors.unreachableAnchors, undefined);
		assert.strictEqual(
			computeInScopeShas(withoutTip, scope, anchors.focalTipShas, anchors.mergeTargetShas, anchors.forkPointShas),
			undefined,
		);
	});
});
