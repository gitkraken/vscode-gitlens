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
	// Parked-lane floor of the last FULL run — appends never park, but the prefix still holds that
	// run's parked rows, so the floor must survive append cycles for the caller's pref filtering.
	preferredColumnFloor: number;
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
		/** Sticky-column hints from a prior run (sha → column) — see `computeColumnsAndSegments`. */
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
	/** The spans actually reused from `reconcile.priorRows` (prior row identity), when any. */
	reconciled?: ReconciledSuffix;
	/**
	 * First column at/above which this run PARKED lanes (0 = none). Exclude columns ≥ this floor
	 * when building the next run's `preferredColumns` from this run's output — feeding parked
	 * columns back ratchets the lane space upward on every update (see `computeColumnsAndSegments`).
	 */
	preferredColumnFloor: number;
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
			preferredColumnFloor: resume.preferredColumnFloor ?? 0,
		};
		return {
			rows: allRows,
			segments: segments,
			unloadedColumns: unloadedColumns,
			resume: nextResume as unknown as GraphProcessResume,
			preferredColumnFloor: resume.preferredColumnFloor ?? 0,
		};
	}

	const rows: GraphRow[] = commits.map(commitToGraphRow);
	const {
		rows: processed,
		segments,
		unloadedColumns,
		snapshot,
		preferredColumnFloor,
	} = computeColumnsAndSegments(rows, {
		pinnedShas: options?.pinnedShas,
		preferredColumns: options?.preferredColumns,
	});
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
		preferredColumnFloor: preferredColumnFloor,
	};
	// Surface `unloadedColumns` so the lane-collapse / scope re-pass (which re-runs `computeEdges` over the
	// filtered rows) can re-thread it — otherwise the dangling stub vanishes the moment any lane folds.
	return {
		rows: processed,
		segments: segments,
		unloadedColumns: unloadedColumns,
		resume: nextResume as unknown as GraphProcessResume,
		reconciled: reconciled,
		preferredColumnFloor: preferredColumnFloor,
	};
}
