/**
 * Convenience pipeline that runs the engine end-to-end over a list of consumer commits.
 *
 * Returns TOPOLOGY-ONLY processed rows: output rows align 1:1 by index with the input commits, so
 * consumers keep payload (refs, message, author, …) in their own aligned store and look it up by
 * index/sha. Keeping payload OFF the engine rows is what lets a payload-only change (e.g. a ref
 * move) skip the engine entirely — the row objects, and everything derived from their identity,
 * stay valid.
 *
 * Consumers that already have `GraphRow[]` can call `computeColumns` + `computeEdges`
 * directly — this helper just wires them together for the common case.
 */

import { computeEdges } from './edges.js';
import type { GraphLayoutSnapshot } from './layout.js';
import { appendColumnsAndSegments, computeColumns, computeColumnsAndSegments } from './layout.js';
import type { ReconciledSuffix } from './reconcile.js';
import { alignRowsSuffixByLayout } from './reconcile.js';
import type { GraphCommit, GraphRow, LaneSegment, ProcessedGraphRow, RowEdges, Sha } from './types.js';

// Opaque resume token for `processCommitsAndSegments` — bundles the layout snapshot, the last row's
// edges (edge-pass carry-over), the accumulated processed rows, and the prior commit count. Callers hold
// it verbatim across paging and pass it back; the shape is private.
declare const processResumeBrand: unique symbol;
export type GraphProcessResume = { readonly [processResumeBrand]: true };
interface InternalProcessResume {
	layout: GraphLayoutSnapshot;
	lastEdges: RowEdges;
	priorRows: ProcessedGraphRow[];
	commitCount: number;
}

// Opaque sticky-columns token — bundles a run's output so the NEXT run can reproduce its lane assignments
// (colours + splice stability) without the consumer knowing how preferences are derived. Callers hold it
// verbatim and pass it back as `stableFrom`; the shape is private, which is the point: the feed ordering
// (below-window stubs first, real rows win) is an engine detail, not a contract the renderer must honour.
declare const processStabilityBrand: unique symbol;
export type GraphStability = { readonly [processStabilityBrand]: true };
interface InternalStability {
	rows: readonly ProcessedGraphRow[];
	unloadedColumns: ReadonlyMap<Sha, number>;
}

// Sticky preferences from a prior run's output. Below-window stubs are seeded FIRST so a real row's column
// always wins the tie: the two sets are disjoint for well-formed (children-first) rows, but a stray stub for
// a sha that IS loaded must never clobber that row's true column, or the lane space ratchets by one on every
// update. This is the sole home of that ordering — it used to live in the renderer.
function preferencesFromStability(stability: GraphStability | undefined): ReadonlyMap<Sha, number> | undefined {
	if (stability == null) return undefined;

	const prior = stability as unknown as InternalStability;
	const preferred = new Map<Sha, number>();
	for (const [sha, column] of prior.unloadedColumns) {
		preferred.set(sha, column);
	}
	for (const row of prior.rows) {
		preferred.set(row.sha, row.column);
	}
	return preferred;
}

function commitToGraphRow(commit: GraphCommit): GraphRow {
	return {
		sha: commit.hash,
		parents: commit.parents,
		// Consumer-supplied kind wins (workdir/stash can't be inferred from parents alone);
		// otherwise fall back to the parent-count heuristic.
		kind: commit.kind ?? (commit.parents.length > 1 ? 'merge' : 'commit'),
		// Already Unix ms (the producer no longer round-trips through an ISO string); the layout's
		// stash-vs-commit lane tie-break reads it directly. A non-finite/absent value maps to 0.
		date: Number.isFinite(commit.date) ? commit.date : 0,
	};
}

export function processCommits(
	commits: readonly GraphCommit[],
	options?: {
		/** Ordered branch heads to pin to successive columns (0, 1, 2, …) — see `assignPinnedColumns`. */
		pinnedShas?: readonly Sha[];
		/**
		 * Shas whose outgoing edges should be marked as synthetic — the renderer styles them
		 * with the wavy SVG filter so the user sees that the lane segment is bridging an
		 * unloaded gap (typical use: scoped views where the actual parent chain is filtered
		 * out and we want to imply continuity to the merge-base anchor).
		 */
		syntheticChildren?: ReadonlySet<Sha>;
	},
): ProcessedGraphRow[] {
	const rows: GraphRow[] = commits.map(commitToGraphRow);
	const processed = computeColumns(rows, options);
	computeEdges(processed, options?.syntheticChildren ? { syntheticChildren: options.syntheticChildren } : undefined);
	return processed;
}

/**
 * Same as `processCommits` but also returns the lane segments identified during layout.
 * Use this when the renderer needs to support lane-collapse — the `segments` array lets
 * the caller filter rows into a chip-collapsed view without re-running the engine.
 *
 * Edge computation must happen over the FULL row set (not a pre-filtered one) because
 * the edge state machine carries column reservations forward via row-by-row chaining;
 * filter the rows after the engine has run, not before.
 */
export function processCommitsAndSegments(
	commits: readonly GraphCommit[],
	options?: {
		/** Ordered branch heads to pin to successive columns (0, 1, 2, …) — see `assignPinnedColumns`. */
		pinnedShas?: readonly Sha[];
		syntheticChildren?: ReadonlySet<Sha>;
		/** Resume token from a prior call to continue the pass over freshly-paged rows in O(page) time. */
		resume?: GraphProcessResume;
		/** Sticky-columns token from a prior run — reproduces its lane assignments. The preferred consumer
		 *  API: opaque, so the caller never encodes the preference-derivation. Ignored if `preferredColumns`
		 *  is also given (an explicit map wins, for low-level/test callers). */
		stableFrom?: GraphStability;
		/** Explicit sticky-column hints (sha → column) — the low-level escape hatch; most callers pass
		 *  `stableFrom` instead. See `computeColumnsAndSegments`. */
		preferredColumns?: ReadonlyMap<Sha, number>;
		/**
		 * Prefix-change reconciliation: the layout still runs over everything (it's the cheap pass —
		 * segments/unloaded columns must be exact), but the EDGE pass — the expensive one — stops as
		 * soon as its carry converges with the prior run's and splices the prior row objects (edges
		 * included) in wholesale. Reused rows keep their prior IDENTITY, so identity-keyed consumers
		 * can splice too. Byte-identical to a full run by construction (asserted by the tests).
		 */
		reconcile?: {
			priorRows: readonly ProcessedGraphRow[];
			/** Locates a sha in the prior rows (for cut/grown-bottom alignment). */
			priorIndexOfSha?: (sha: Sha) => number | undefined;
		};
	},
): {
	rows: ProcessedGraphRow[];
	segments: readonly LaneSegment[];
	unloadedColumns: ReadonlyMap<Sha, number>;
	/** Resume token to pass back on the next page-in for an incremental append. */
	resume: GraphProcessResume;
	/** Sticky-columns token to pass back as `stableFrom` on the next update, to reproduce these lanes. */
	stability: GraphStability;
	/** The spans actually reused from `reconcile.priorRows` (prior row identity), when any. */
	reconciled?: ReconciledSuffix;
	/** True when this run DISCARDED the sticky preferences and adopted a cold layout because the sticky
	 *  one had degraded (see the renormalize block). Lets the caller expect a wholesale lane reshuffle for
	 *  this one update — colours/columns move — instead of the usual stable relayout. */
	renormalized?: boolean;
} {
	// Incremental append: continue from the prior snapshot when this call is a pure APPEND of the SAME
	// prefix (older commits added at the bottom), with no pinned lanes and no scope (synthetic edges) —
	// the only case an append is byte-identical to a full recompute (asserted by the equivalence tests).
	// The boundary-sha check guards against a changed prefix; anything else falls through to a full run.
	const resume = options?.resume != null ? (options.resume as unknown as InternalProcessResume) : undefined;
	if (
		resume != null &&
		options?.pinnedShas == null &&
		options?.syntheticChildren == null &&
		commits.length > resume.commitCount &&
		resume.commitCount > 0 &&
		resume.priorRows[resume.commitCount - 1]?.sha === commits[resume.commitCount - 1]?.hash
	) {
		const newCommits = commits.slice(resume.commitCount);
		const newRows: GraphRow[] = newCommits.map(commitToGraphRow);
		const {
			rows: appended,
			segments,
			unloadedColumns,
			snapshot,
		} = appendColumnsAndSegments(resume.layout, newRows);
		// Continue the edge pass from the boundary's last row; prior rows keep their edges (columns are
		// stable across paging, so they're already identical to a full recompute).
		computeEdges(appended, { unloadedColumns: unloadedColumns, resumePrev: resume.lastEdges });
		const allRows = [...resume.priorRows, ...appended];
		const lastEdges = appended.at(-1)?.edges ?? resume.lastEdges;
		const nextResume: InternalProcessResume = {
			layout: snapshot,
			lastEdges: lastEdges,
			priorRows: allRows,
			commitCount: commits.length,
		};
		return {
			rows: allRows,
			segments: segments,
			unloadedColumns: unloadedColumns,
			resume: nextResume as unknown as GraphProcessResume,
			stability: { rows: allRows, unloadedColumns: unloadedColumns } as unknown as GraphStability,
		};
	}

	const rows: GraphRow[] = commits.map(commitToGraphRow);
	// An explicit map wins (test/low-level callers); otherwise derive from the opaque token.
	const preferredColumns = options?.preferredColumns ?? preferencesFromStability(options?.stableFrom);
	let layout = computeColumnsAndSegments(rows, {
		pinnedShas: options?.pinnedShas,
		preferredColumns: preferredColumns,
	});

	// RENORMALIZE. Sticky preferences are a ratchet in one direction: a lane that can't get a low column on
	// the update it arrives keeps that column forever, and because a lane spans its tip down to its fork
	// point, ONE badly-placed tip inflates the gutter for every row it crosses (measured: a tip that belongs
	// on column 1 parked on column 9 and dragged a 250-row lane through the whole visible graph). Nothing
	// recovers from it, which is why reopening the graph — a preference-less run — "fixes" it.
	//
	// So do that automatically. A cold layout is the layout-only (cheap) pass — the edge pass, the expensive
	// half, runs once below over whichever layout we keep — so we can afford to compute it and COMPARE by
	// gutter area (`laneArea`), then keep the sticky layout unless cold is tighter by more than one full
	// column of height. The slack is what preserves stability: in steady state the sticky layout reproduces
	// its prior columns and cold cannot beat it by a whole column, so nothing reshuffles; only a genuinely
	// degraded layout (a far-right lane dragging the gutter out) loses to cold and gets discarded. Skipped
	// when the run is already preference-less (a cold open / paging append is optimal by construction) or
	// pinned (a pinned layout isn't comparable to an unpinned cold one).
	let renormalized = false;
	if (preferredColumns != null && preferredColumns.size > 0 && options?.pinnedShas == null) {
		const cold = computeColumnsAndSegments(rows);
		if (cold.laneArea + rows.length < layout.laneArea) {
			layout = cold;
			renormalized = true;
		}
	}
	const { rows: processed, segments, unloadedColumns, snapshot } = layout;
	// Prefix-change reconciliation: align the fresh LAYOUT against the prior rows so the edge pass
	// can stop at carry convergence and adopt the prior row objects (edges included) wholesale.
	// Scoped/pinned runs are excluded — their edges carry synthetic/pinned state a prior plain run
	// can't stand in for.
	let splice:
		| { prior: readonly ProcessedGraphRow[]; priorStart: number; nextStart: number; reused: number }
		| undefined;
	if (options?.reconcile != null && options.syntheticChildren == null && options.pinnedShas == null) {
		const aligned = alignRowsSuffixByLayout(
			options.reconcile.priorRows,
			processed,
			options.reconcile.priorIndexOfSha,
		);
		if (aligned != null) {
			splice = { prior: options.reconcile.priorRows, ...aligned };
		}
	}
	// Pass `unloadedColumns` so a merge whose additional parent is below the loaded window draws a
	// dangling stub down its reserved lane instead of leaving an unexplained empty lane.
	const { splicedFrom } = computeEdges(processed, {
		syntheticChildren: options?.syntheticChildren,
		unloadedColumns: unloadedColumns,
		splice: splice,
	});
	let reconciled: ReconciledSuffix | undefined;
	if (splice != null && splicedFrom != null) {
		const shift = splice.nextStart - splice.priorStart;
		reconciled = {
			reused: splice.nextStart + splice.reused - splicedFrom,
			priorStart: splicedFrom - shift,
			nextStart: splicedFrom,
		};
	}
	const nextResume: InternalProcessResume = {
		layout: snapshot,
		lastEdges: processed.at(-1)?.edges ?? {},
		priorRows: processed,
		commitCount: commits.length,
	};
	// Surface `unloadedColumns` so the lane-collapse / scope re-pass (which re-runs `computeEdges` over the
	// filtered rows) can re-thread it — otherwise the dangling stub vanishes the moment any lane folds.
	return {
		rows: processed,
		segments: segments,
		unloadedColumns: unloadedColumns,
		resume: nextResume as unknown as GraphProcessResume,
		stability: { rows: processed, unloadedColumns: unloadedColumns } as unknown as GraphStability,
		reconciled: reconciled,
		renormalized: renormalized,
	};
}
