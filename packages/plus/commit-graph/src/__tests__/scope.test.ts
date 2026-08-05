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
		// Focal spine = the branch's commits + the fork point, which heads the older-history fold.
		assert.deepStrictEqual(visible, ['F2', 'F1', 'M3']);
		assert.deepStrictEqual([...(projection?.foldSegments.keys() ?? [])], ['M3']);
		assert.strictEqual(projection?.hiddenCountByTipSha.get('M3'), 3);
	});

	test('the older-history fold heads at the merge base, not the commit below it', () => {
		// The base is the scope's last row and carries the chevron itself, so a collapsed fold costs no extra
		// row and no out-of-scope commit sits at the bottom of a focused graph.
		const { projection, visible } = project(scopeTo('M3', 'M3'));

		assert.strictEqual(visible.at(-1), 'M3');
		assert.strictEqual(projection?.dropped.has('M2'), true);
		assert.deepStrictEqual([...(projection?.collapsedByTipSha.keys() ?? [])], ['M3']);
	});

	test('a branch level with its merge target re-roots onto its tip alone', () => {
		// A branch with nothing ahead of its target: tip, fork point and target tip are all one commit.
		// `computeScopeAnchor` used to read that as "no merge target at all" and leave the scope bare,
		// and a bare scope dims every row off the focal tip's first-parent line instead of focusing.
		// Anchored, the projection degenerates honestly — the tip as a one-commit spine plus the fold.
		const { anchors, projection, visible } = project(scopeTo('F2', 'F2'));

		assert.deepStrictEqual([...(anchors.focalTipShas ?? [])], ['F2']);
		assert.deepStrictEqual([...(anchors.forkPointShas ?? [])], ['F2']);
		assert.deepStrictEqual([...(anchors.mergeTargetShas ?? [])], ['F2']);
		// All three coincide on a loaded row, so nothing is reported unreachable and nothing pages.
		assert.strictEqual(anchors.unreachableAnchors, undefined);

		// One fold only — the merge-target fold is skipped because the target tip IS the merge base — and it
		// heads at that same commit, so the whole scope is the tip row carrying its own chevron.
		assert.deepStrictEqual(visible, ['F2']);
		assert.deepStrictEqual([...(projection?.foldSegments.keys() ?? [])], ['F2']);
		assert.strictEqual(projection?.hiddenCountByTipSha.get('F2'), 5);
	});

	test('the WIP row survives a branch level with its merge target', () => {
		// The tip-equality bail this replaced justified itself partly on a WIP-row hazard in the removed
		// legacy engine. This engine keeps a workdir row whose parent is on the spine, and the degenerate
		// spine is exactly the tip the row hangs off.
		const { wipVisible } = projectWithWip(scopeTo('F2', 'F2'), 'F2');
		assert.strictEqual(wipVisible, true);
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
		// M2/M1 are trunk dragged into the spine; M0 folds under the stale base.
		assert.deepStrictEqual(visible, ['F2', 'F1', 'M3', 'M2', 'M1']);
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

	test('a branch that merged its target in keeps its own commits in the spine', () => {
		// The shared fixture can't express this: it needs a merge commit, which puts the merge base on a
		// SECOND parent — off the focal first-parent line — with a date interleaved among the branch's own
		// commits. Bounding the walk by the base's ROW POSITION then fires partway up the branch and truncates
		// the spine (here: at G1, so the branch's oldest commit vanishes from its own focused view). The merge
		// target's first-parent line is a topology test rather than a date one, so it stops in the right place.
		//   G2 (merge: G1 + T2) -> G1 -> G0 -> R      trunk: T3 -> T2 -> T1 -> R
		const merged: Record<Sha, Sha[]> = {
			G2: ['G1', 'T2'],
			T3: ['T2'],
			G1: ['G0'],
			T2: ['T1'],
			G0: ['R'],
			T1: ['R'],
			R: [],
		};
		const mergedShas = Object.keys(merged);
		const mergedRows = mergedShas.map(sha => ({
			sha: sha,
			parents: merged[sha],
			heads: sha === 'G2' ? [{ id: 'h-g', name: 'gh', isCurrentHead: true }] : undefined,
		}));
		const mergedProcessed: ProcessedGraphRow[] = mergedShas.map(sha => ({
			sha: sha,
			parents: merged[sha],
			kind: 'commit',
			column: sha.startsWith('G') ? 1 : 0,
			edges: {},
			edgeColumnMax: 0,
		}));
		const scope: HostScope = {
			branchName: 'gh',
			branchRef: '/repo|heads/gh',
			mergeBase: { sha: 'T2', date: 1 },
			mergeTargetTipSha: 'T3',
		};
		const anchors = computeScopeAnchors(mergedRows, scope, hasHead);
		const projection = computeScopeProjection(mergedProcessed, scope, anchors, new Set());

		// The whole branch, not just the commits that happen to sort above the base.
		assert.strictEqual(projection?.dropped.has('G1'), false);
		assert.strictEqual(projection?.dropped.has('G0'), false);
		// The two folds must not both claim the shared history — the target fold stops AT the base.
		assert.deepStrictEqual(
			Array.from(projection?.foldSegments.entries() ?? [], ([k, v]) => `${k}:${v.commitShas.join(',')}`),
			['T3:T3', 'T2:T2,T1,R'],
		);
	});

	test('a loaded merge base still shows when nothing else would keep it', () => {
		// Two things have to line up to lose it: the base is off the focal first-parent line (so the spine
		// walks past it) AND its own first parent isn't loaded (so the older-history fold that would head at
		// it is skipped). The anchors publish it as the fork point either way, so without an explicit keep it
		// resolves as an anchor that renders nowhere — no Base marker, and no sign history continues below.
		//   H1 (merge: H0 + U1) -> H0 -> <unloaded>    trunk: U2 -> U1 (base) -> <unloaded>
		const atEdge: Record<Sha, Sha[]> = {
			H1: ['H0', 'U1'],
			U2: ['U1'],
			H0: ['unloaded-a'],
			U1: ['unloaded-b'],
		};
		const edgeShas = Object.keys(atEdge);
		const edgeRows = edgeShas.map(sha => ({
			sha: sha,
			parents: atEdge[sha],
			heads: sha === 'H1' ? [{ id: 'h-h', name: 'hh', isCurrentHead: true }] : undefined,
		}));
		const edgeProcessed: ProcessedGraphRow[] = edgeShas.map(sha => ({
			sha: sha,
			parents: atEdge[sha],
			kind: 'commit',
			column: sha.startsWith('H') ? 1 : 0,
			edges: {},
			edgeColumnMax: 0,
		}));
		const scope: HostScope = {
			branchName: 'hh',
			branchRef: '/repo|heads/hh',
			mergeBase: { sha: 'U1', date: 1 },
			mergeTargetTipSha: 'U2',
		};
		const anchors = computeScopeAnchors(edgeRows, scope, hasHead);
		const projection = computeScopeProjection(edgeProcessed, scope, anchors, new Set());

		assert.deepStrictEqual([...(anchors.forkPointShas ?? [])], ['U1']);
		assert.strictEqual(projection?.dropped.has('U1'), false);
		// No older-history fold to head at it — the keep is what makes it visible.
		assert.deepStrictEqual([...(projection?.foldSegments.keys() ?? [])], ['U2']);
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

// Stack fixture: three layers rebased onto each other, so they form ONE first-parent line above main.
//   L3b -> L3a -> L2b -> L2a -> L1b -> L1a -> M3 (main tip) -> M2 -> M1 -> M0
const stackParents: Record<Sha, Sha[]> = {
	L3b: ['L3a'],
	L3a: ['L2b'],
	L2b: ['L2a'],
	L2a: ['L1b'],
	L1b: ['L1a'],
	L1a: ['M3'],
	M3: ['M2'],
	M2: ['M1'],
	M1: ['M0'],
	M0: [],
};
const stackShas = Object.keys(stackParents);
const stackHeads: Record<Sha, string> = { L3b: 'layer-3', L2b: 'layer-2', L1b: 'layer-1', M3: 'main' };

const stackRows: HostRow[] = stackShas.map(sha => ({
	sha: sha,
	parents: stackParents[sha],
	heads: stackHeads[sha] != null ? [{ id: `h-${sha}`, name: stackHeads[sha], isCurrentHead: false }] : undefined,
}));

const stackProcessedRows: ProcessedGraphRow[] = stackShas.map(sha => ({
	sha: sha,
	parents: stackParents[sha],
	kind: 'commit',
	column: sha.startsWith('L') ? 1 : 0,
	edges: {},
	edgeColumnMax: 0,
}));

/** Focal on the stack's BASE layer — the layer whose own merge target really is the trunk. */
function stackScope(additionalBranchNames?: string[]): HostScope {
	return {
		branchName: 'layer-1',
		branchRef: '/repo|heads/layer-1',
		mergeBase: { sha: 'M3', date: 1 },
		mergeTargetTipSha: 'M3',
		...(additionalBranchNames != null ? { additionalBranchNames: additionalBranchNames } : undefined),
	};
}

function projectStack(scope: HostScope) {
	const anchors = computeScopeAnchors(stackRows, scope, hasHead);
	const projection = computeScopeProjection(stackProcessedRows, scope, anchors, new Set());
	return {
		anchors: anchors,
		visible: stackShas.filter(sha => projection == null || !projection.dropped.has(sha)),
	};
}

suite('scope — additional branches', () => {
	test('the base layer alone cannot reach the layers stacked above it', () => {
		// The layers above are DESCENDANTS of the focal tip, and the spine only ever walks down — which is
		// the whole reason additional branches exist rather than being a nicety.
		const { visible } = projectStack(stackScope());

		assert.deepEqual(visible, ['L1b', 'L1a', 'M3']);
	});

	test('additional branches bring the layers above into scope', () => {
		const { visible } = projectStack(stackScope(['layer-2', 'layer-3']));

		assert.deepEqual(visible, ['L3b', 'L3a', 'L2b', 'L2a', 'L1b', 'L1a', 'M3']);
	});

	test('the focal tip stays the focal tip', () => {
		// Additional tips must not displace it: the focal-tip rail, and everything else that asks for "the"
		// focal tip, still has to resolve to exactly one commit.
		const { anchors } = projectStack(stackScope(['layer-2', 'layer-3']));

		assert.deepEqual([...(anchors.focalTipShas ?? [])], ['L1b']);
		assert.deepEqual([...(anchors.additionalTipShas ?? [])].sort(), ['L2b', 'L3b']);
	});

	test('additional tips are anchors and synthetic-edge sources', () => {
		const { anchors } = projectStack(stackScope(['layer-2', 'layer-3']));

		assert.equal(anchors.anchorShas?.has('L2b'), true);
		assert.equal(anchors.anchorShas?.has('L3b'), true);
		assert.equal(anchors.syntheticChildren?.has('L3b'), true);
	});

	test('an additional branch that is not loaded is ignored, not fatal', () => {
		const { visible, anchors } = projectStack(stackScope(['layer-2', 'layer-99']));

		assert.deepEqual([...(anchors.additionalTipShas ?? [])], ['L2b']);
		assert.deepEqual(visible, ['L2b', 'L2a', 'L1b', 'L1a', 'M3']);
	});

	test('the additional lines are in scope for dimming too', () => {
		const scope = stackScope(['layer-2', 'layer-3']);
		const anchors = computeScopeAnchors(stackRows, scope, hasHead);
		const inScope = computeInScopeShas(
			stackRows,
			scope,
			anchors.focalTipShas,
			anchors.mergeTargetShas,
			anchors.forkPointShas,
			anchors.additionalTipShas,
		);

		for (const sha of ['L1a', 'L1b', 'L2a', 'L2b', 'L3a', 'L3b']) {
			assert.equal(inScope?.has(sha), true, `${sha} should be in scope`);
		}
	});

	test('naming the focal branch again changes nothing', () => {
		const { visible } = projectStack(stackScope(['layer-1', 'layer-2']));

		assert.deepEqual(visible, ['L2b', 'L2a', 'L1b', 'L1a', 'M3']);
	});
});
