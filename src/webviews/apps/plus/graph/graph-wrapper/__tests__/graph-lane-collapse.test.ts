import * as assert from 'assert';
import { processCommitsAndSegments } from '@gitkraken/commit-graph/engine/process.js';
import { reconcileRowsSuffix } from '@gitkraken/commit-graph/engine/reconcile.js';
import type { GraphCommit, LaneSegment, ProcessedGraphRow, Sha } from '@gitkraken/commit-graph/engine/types.js';
import {
	appendDroppedRows,
	applyDroppedRows,
	computeDefaultCollapsedSet,
	computeDroppedShas,
	computeSegmentMaps,
	computeTrunkSegmentTip,
	spliceDroppedRows,
} from '../graph-lane-collapse.js';

function commit(hash: string, parents: string[]): GraphCommit {
	return {
		hash: hash,
		shortHash: hash.slice(0, 7),
		message: hash,
		author: 'Tester',
		authorEmail: 'test@example.com',
		date: 0,
		parents: parents,
		refs: [],
	};
}

// Run the full collapse pipeline over `rows` for a FIXED collapsed tip set (mirrors the renderer's
// frozen default-collapse across appends), returning the filter inputs + output.
function collapsePass(
	rows: readonly ProcessedGraphRow[],
	segments: readonly LaneSegment[],
	collapsedTips: ReadonlySet<Sha>,
	unloadedColumns: ReadonlyMap<Sha, number>,
): {
	dropped: Set<Sha>;
	filtered: readonly ProcessedGraphRow[];
	collapsedByTipSha: ReadonlyMap<Sha, LaneSegment>;
} {
	const trunk = computeTrunkSegmentTip(segments, rows, undefined);
	const maps = computeSegmentMaps({
		segments: segments,
		trunkSegmentTip: trunk,
		effectiveCollapsed: collapsedTips,
		wipAnchorShas: new Set(),
	});
	const dropped = computeDroppedShas(maps.collapsedByTipSha, maps.visibleJunctions);
	const filtered = dropped.size === 0 ? rows : applyDroppedRows(rows, dropped, unloadedColumns);
	return { dropped: dropped, filtered: filtered, collapsedByTipSha: maps.collapsedByTipSha };
}

// Assert the incremental collapse append (prior filter output + appended tail) is byte-identical to
// running the full filter over the combined rows, at every split point where the renderer's guards
// would allow the incremental path (drop-set delta confined to the appended region).
function assertCollapseAppendMatchesFull(commits: readonly GraphCommit[]): void {
	const full = processCommitsAndSegments(commits);
	// The frozen collapsed set: every foldable ('all' mode, non-trunk) segment of the FULL graph that
	// is also finalized identically in each prefix run gets checked per split below.
	for (let split = 2; split < commits.length; split++) {
		const prefix = processCommitsAndSegments(commits.slice(0, split));
		const appended = processCommitsAndSegments(commits, { resume: prefix.resume });

		// Freeze the default set as of the PREFIX run — exactly what the renderer does on appends.
		const trunkPrefix = computeTrunkSegmentTip(prefix.segments, prefix.rows, undefined);
		const frozen = computeDefaultCollapsedSet({
			lanesCollapseDefault: 'all',
			segments: prefix.segments,
			searchActive: false,
			trunkSegmentTip: trunkPrefix,
			wipTipShas: new Set(),
		});
		if (frozen.size === 0) continue;

		const prior = collapsePass(prefix.rows, prefix.segments, frozen, prefix.unloadedColumns);
		const current = collapsePass(appended.rows, appended.segments, frozen, appended.unloadedColumns);

		// Renderer guards: skip splits where the drop delta reaches into the prior region or a prior
		// below-window parent got dropped — the renderer falls back to the full filter there.
		const priorRegion = new Set(prefix.rows.map(r => r.sha));
		let guarded = false;
		for (const sha of current.dropped) {
			if (!prior.dropped.has(sha) && priorRegion.has(sha)) {
				guarded = true;
			}
		}
		for (const sha of prior.dropped) {
			if (!current.dropped.has(sha) && priorRegion.has(sha)) {
				guarded = true;
			}
		}
		for (const sha of prefix.unloadedColumns.keys()) {
			if (current.dropped.has(sha)) {
				guarded = true;
			}
		}
		if (guarded) continue;

		const bySha = new Map(appended.rows.map((r, i) => [r.sha, i]));
		const incremental = appendDroppedRows({
			priorDisplayRows: prior.filtered,
			processedRows: appended.rows,
			firstNewIndex: split,
			dropped: current.dropped,
			rowBySha: sha => {
				const i = bySha.get(sha);
				return i != null ? appended.rows[i] : undefined;
			},
			unloadedColumns: appended.unloadedColumns,
		});

		assert.deepStrictEqual(
			incremental,
			current.filtered,
			`incremental collapse append at split ${split} diverged from the full filter`,
		);
	}
}

suite('graph-lane-collapse incremental append equivalence', () => {
	test('completed side branch in the prefix, trunk extends through the append', () => {
		assertCollapseAppendMatchesFull([
			commit('M', ['A', 'X1']),
			commit('X1', ['X2']),
			commit('X2', ['A']),
			commit('A', ['B']),
			commit('B', ['C']),
			commit('C', ['D']),
			commit('D', []),
		]);
	});

	test('collapsed segment extends across the append boundary', () => {
		assertCollapseAppendMatchesFull([
			commit('M', ['A', 'X1']),
			commit('X1', ['X2']),
			commit('X2', ['X3']),
			commit('X3', ['B']),
			commit('A', ['B']),
			commit('B', []),
		]);
	});

	test('second side branch pages in below (stays expanded under the frozen set)', () => {
		assertCollapseAppendMatchesFull([
			commit('M1', ['A', 'X1']),
			commit('X1', ['A']),
			commit('A', ['B']),
			commit('M2', ['B', 'Y1']),
			commit('Y1', ['B']),
			commit('B', ['C']),
			commit('C', []),
		]);
	});

	test('merge with an unloaded parent resolving inside the appended region', () => {
		assertCollapseAppendMatchesFull([
			commit('M', ['A', 'Z']),
			commit('X1', ['A']),
			commit('A', ['B']),
			commit('B', ['Z']),
			commit('Z', ['W']),
			commit('W', []),
		]);
	});

	test('multi-lane fan with folds on both sides of the boundary', () => {
		assertCollapseAppendMatchesFull([
			commit('T', ['M1', 'P1']),
			commit('M1', ['A', 'Q1']),
			commit('P1', ['P2']),
			commit('Q1', ['A']),
			commit('P2', ['A']),
			commit('A', ['B']),
			commit('R1', ['B']),
			commit('B', ['C']),
			commit('C', []),
		]);
	});
});

// Assert the incremental collapse PREFIX-SPLICE (reprocessed head + reused prior suffix survivors)
// is byte-identical to the full filter over the new rows, for a given prepended-commits variant —
// optionally with bottom rows cut (the host reloads a fixed count, so a prepend trims the tail).
// Returns whether the splice path actually ran (guards + edge-carry convergence can bail).
function assertCollapseSpliceMatchesFull(
	base: readonly GraphCommit[],
	prepended: readonly GraphCommit[],
	cutBottom = 0,
	growBottom = 0,
): boolean {
	// `growBottom` simulates the host loading FURTHER than the prior window on the rebuild: the
	// prior run had fewer bottom rows than the new one.
	const prior = processCommitsAndSegments(growBottom > 0 ? base.slice(0, -growBottom) : base);
	const nextCommits = [...prepended, ...base];
	const next = processCommitsAndSegments(cutBottom > 0 ? nextCommits.slice(0, -cutBottom) : nextCommits);

	const priorIdx = new Map(prior.rows.map((r, i) => [r.sha, i]));
	const reconciled = reconcileRowsSuffix(prior.rows, next.rows, sha => priorIdx.get(sha));
	if (reconciled == null) return false;

	// Freeze the collapsed set as of the PRIOR run ('all' mode) — what the renderer carries over.
	const trunkPrior = computeTrunkSegmentTip(prior.segments, prior.rows, undefined);
	const frozen = computeDefaultCollapsedSet({
		lanesCollapseDefault: 'all',
		segments: prior.segments,
		searchActive: false,
		trunkSegmentTip: trunkPrior,
		wipTipShas: new Set(),
	});
	if (frozen.size === 0) return false;

	const priorPass = collapsePass(prior.rows, prior.segments, frozen, prior.unloadedColumns);
	const nextPass = collapsePass(next.rows, next.segments, frozen, next.unloadedColumns);

	// Renderer guards: the drop delta must lie outside the reused run; no prior below-window
	// parent may have become dropped.
	const { reused, priorStart, nextStart } = reconciled;
	const inReusedRun = (sha: Sha): boolean => {
		const i = priorIdx.get(sha);
		return i != null && i >= priorStart && i < priorStart + reused;
	};
	for (const sha of nextPass.dropped) {
		if (!priorPass.dropped.has(sha) && inReusedRun(sha)) return false;
	}
	for (const sha of priorPass.dropped) {
		if (!nextPass.dropped.has(sha) && inReusedRun(sha)) return false;
	}
	for (const sha of prior.unloadedColumns.keys()) {
		if (nextPass.dropped.has(sha)) return false;
	}

	const nextIdx = new Map(next.rows.map((r, i) => [r.sha, i]));
	const incremental = spliceDroppedRows({
		priorDisplayRows: priorPass.filtered,
		processedRows: next.rows,
		suffixStartIndex: nextStart,
		suffixEndIndex: nextStart + reused,
		priorIndexBySha: sha => priorIdx.get(sha),
		priorSuffixStart: priorStart,
		priorSuffixEnd: priorStart + reused,
		dropped: nextPass.dropped,
		rowBySha: sha => {
			const i = nextIdx.get(sha);
			return i != null ? next.rows[i] : undefined;
		},
		unloadedColumns: next.unloadedColumns,
	});
	if (incremental == null) return false;

	assert.deepStrictEqual(incremental, nextPass.filtered, 'prefix splice diverged from the full filter');
	return true;
}

suite('graph-lane-collapse prefix-splice equivalence', () => {
	// Trunk + one completed side branch (collapsed under the frozen set).
	const base = [
		commit('M', ['A', 'X1']),
		commit('X1', ['X2']),
		commit('X2', ['A']),
		commit('A', ['B']),
		commit('B', ['C']),
		commit('C', ['D']),
		commit('D', []),
	];

	test('single commit prepended on the trunk splices exactly', () => {
		assert.ok(assertCollapseSpliceMatchesFull(base, [commit('N', ['M'])]), 'expected the splice path to run');
	});

	test('several commits prepended splice exactly', () => {
		assert.ok(
			assertCollapseSpliceMatchesFull(base, [commit('N1', ['N2']), commit('N2', ['N3']), commit('N3', ['M'])]),
			'expected the splice path to run',
		);
	});

	test('prepend with the bottom cut (fixed-count reload) splices via the anchor alignment', () => {
		assert.ok(
			assertCollapseSpliceMatchesFull(base, [commit('N', ['M'])], 1),
			'expected the splice path to run across the bottom cut',
		);
	});

	test('prepend with the bottom grown (rebuild loaded further) splices head + reuse + tail', () => {
		assert.ok(
			assertCollapseSpliceMatchesFull(base, [commit('N', ['M'])], 0, 2),
			'expected the splice path to run across the grown bottom',
		);
	});

	test('a prepended merge fan converges and splices (or safely bails)', () => {
		// A new branch + merge at the top can shift columns deep enough that the reconciliation
		// shortens the reused suffix — equality is asserted whenever the splice path runs.
		assertCollapseSpliceMatchesFull(base, [commit('T', ['P1', 'M']), commit('P1', ['P2']), commit('P2', ['M'])]);
	});

	test('prepend onto a graph with an unloaded merge parent splices or bails safely', () => {
		const withUnloaded = [commit('M', ['A', 'Z']), commit('X1', ['A']), commit('A', ['B']), commit('B', [])];
		assertCollapseSpliceMatchesFull(withUnloaded, [commit('N', ['M'])]);
	});
});
