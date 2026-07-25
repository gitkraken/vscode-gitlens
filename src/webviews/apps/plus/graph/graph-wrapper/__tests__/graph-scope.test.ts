import * as assert from 'assert';
import type { ProcessedGraphRow, Sha } from '@gitkraken/commit-graph/engine/types.js';
import type { GitGraphRow } from '@gitlens/git/models/graph.js';
import type { GraphScope } from '../../../../../plus/graph/protocol.js';
import { computeScopeAnchors, computeScopeProjection } from '../graph-scope.js';

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

const rows = shas.map(sha => {
	const row: Partial<GitGraphRow> = {
		sha: sha,
		parents: parentsBySha[sha],
		type: 'commit-node',
		heads:
			sha === 'F2'
				? [{ id: 'h-feature', name: 'feature', isCurrentHead: true }]
				: sha === 'M3'
					? [{ id: 'h-main', name: 'main', isCurrentHead: false }]
					: undefined,
	};
	return row as GitGraphRow;
});

const processedRows: ProcessedGraphRow[] = shas.map(sha => ({
	sha: sha,
	parents: parentsBySha[sha],
	kind: 'commit',
	column: sha.startsWith('F') ? 1 : 0,
	edges: {},
	edgeColumnMax: 0,
}));

function scopeTo(mergeBaseSha: Sha | undefined, mergeTargetTipSha: Sha | undefined): GraphScope {
	return {
		branchName: 'feature',
		branchRef: '/repo|heads/feature',
		...(mergeBaseSha != null ? { mergeBase: { sha: mergeBaseSha, date: 1 } } : undefined),
		...(mergeTargetTipSha != null ? { mergeTargetTipSha: mergeTargetTipSha } : undefined),
	};
}

function project(scope: GraphScope) {
	const anchors = computeScopeAnchors(rows, scope);
	const projection = computeScopeProjection(processedRows, scope, anchors, new Set());
	return {
		anchors: anchors,
		projection: projection,
		visible: shas.filter(sha => projection == null || !projection.dropped.has(sha)),
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

	test('a merge base outside the loaded rows is surfaced as unreachable (drives the targeted page)', () => {
		// The paging path (`onScopeAnchorsUnreachable` -> `pickScopePageTarget`) keys off this, which is
		// what lets `patchScopeAnchor` apply a fresh-but-unloaded merge base instead of keeping a stale one.
		const { anchors, projection } = project(scopeTo('M9', 'M3'));

		assert.strictEqual(anchors.forkPointShas, undefined);
		assert.deepStrictEqual([...(anchors.unreachableAnchors ?? [])], ['M9']);
		// No loaded fork point -> no re-root; the renderer falls back to dim-in-place.
		assert.strictEqual(projection, undefined);
	});
});
