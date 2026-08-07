/**
 * Lane (column) allocation for the commit graph.
 *
 *   - `pinnedShas` is an arbitrary set of branch heads, each pinned to its own reserved lane.
 *   - Date-based stash tie-breaking is supported, but the engine tolerates rows without
 *     dates (they default to 0) for callers that don't care about stash ordering.
 */

import type { CommitKind, GraphRow, LaneSegment, ProcessedGraphRow, Sha } from './types.js';

interface ReserverInfo {
	kind: CommitKind;
	/** Used to resolve stash-vs-commit reservation conflicts. Unix ms; 0 when unknown. */
	newestDate: number;
	column: number;
}

/**
 * Bookkeeping for an in-progress lane segment. Finalized into a `LaneSegment` when the
 * column is freed (or when the row loop ends, with `forkSha=null`).
 */
interface SegmentBuilder {
	column: number;
	mergeSha: Sha | null;
	commitShas: Sha[];
}

interface LayoutState {
	columnsUsed: Set<number>;
	/** Columns to release from `columnsUsed` when a specific sha is reached. */
	columnsToFreeWhenFound: Map<Sha, number[]>;
	reserverInfoBySha: Map<Sha, ReserverInfo>;
	hasMergeNodeChildBySha: Set<Sha>;
	/** sha → its reserved stack column. Each pinned head's first-parent chain is tagged with that head's
	 *  column (head[0]→0, head[1]→1, …); shared ancestors keep the lower head's column. Empty when nothing
	 *  is pinned. */
	pinnedColumns: ReadonlyMap<Sha, number>;
	/** Low columns reserved for pinned branches (= highest assigned pinned column + 1). Non-pinned commits
	 *  claim columns at/above this so a fresh lane never collides with a pinned-branch lane. */
	pinnedColumnCount: number;
	/** sha → owning pinned head sha (same ownership as `pinnedColumns`, first-owner-wins). Threaded through
	 *  so pinned lanes — which never open a `SegmentBuilder` — can still resolve a ghost-ref tip. */
	pinnedTipByCommit: ReadonlyMap<Sha, Sha>;
	/** In-progress segment builders, keyed by current column index. */
	segmentByColumn: Map<number, SegmentBuilder>;
	/** Finalized segments — appended on column-free, drained at the end of the layout pass. */
	finalizedSegments: LaneSegment[];
}

function createState(
	pinnedColumns: ReadonlyMap<Sha, number>,
	pinnedColumnCount: number,
	pinnedTipByCommit: ReadonlyMap<Sha, Sha>,
): LayoutState {
	return {
		columnsUsed: new Set(),
		columnsToFreeWhenFound: new Map(),
		reserverInfoBySha: new Map(),
		hasMergeNodeChildBySha: new Set(),
		pinnedColumns: pinnedColumns,
		pinnedColumnCount: pinnedColumnCount,
		pinnedTipByCommit: pinnedTipByCommit,
		segmentByColumn: new Map(),
		finalizedSegments: [],
	};
}

/**
 * Build a `LaneSegment` from an in-progress builder and the row that freed its column
 * (or `null` for segments still open at end-of-rows). Returns `null` when the segment
 * has fewer than two placed commits — those aren't worth rendering as a fold chip.
 */
function finalizeSegment(builder: SegmentBuilder, forkSha: Sha | null): LaneSegment | null {
	if (builder.commitShas.length < 2) return null;

	const tipSha = builder.commitShas[0];
	return {
		id: tipSha,
		tipSha: tipSha,
		forkSha: forkSha,
		mergeSha: builder.mergeSha,
		column: builder.column,
		commitShas: builder.commitShas,
	};
}

/**
 * Pick the lowest unused column for a non-pinned commit. Scanning starts ABOVE the reserved pinned
 * columns (`pinnedColumnCount`) so a fresh lane never collides with a pinned-branch lane. (Same as
 * GKC's `getAvailableColumnAndUseIt`, generalized from a single reserved column to N.)
 *
 * Taking the lowest free column is what lets a claim pull its first parent's chain down onto a lower lane
 * via the reservation-replace path in `assignColumnForRow` — GKC's own lane compaction, and what keeps the
 * graph narrow.
 */
function claimNextColumn(state: LayoutState): number {
	let column = state.pinnedColumnCount;
	while (state.columnsUsed.has(column)) {
		column += 1;
	}
	state.columnsUsed.add(column);
	return column;
}

/**
 * Whether the conflict branch in {@link assignColumnForRow} could move `parentSha`'s reservation onto this
 * row's lane — dragging the parent's whole first-parent chain with it.
 *
 * A multi-parent row is excluded because it flags every parent as merge-owned at the top of the parents
 * loop, so by the time the branch runs it can never move its own first parent.
 */
function canReplaceReservation(state: LayoutState, row: GraphRow, parentSha: Sha): boolean {
	return (
		row.parents.length <= 1 && !state.hasMergeNodeChildBySha.has(parentSha) && !state.pinnedColumns.has(parentSha)
	);
}

/**
 * Pick the column for a parent commit. A pinned parent lands on its assigned stack column; the first
 * parent inherits its child's column; additional parents claim a fresh column above the pinned lanes.
 */
function pickParentColumn(state: LayoutState, parentSha: Sha, parentIndex: number, childColumn: number): number {
	const pinned = state.pinnedColumns.get(parentSha);
	if (pinned !== undefined) return pinned;
	return parentIndex === 0 ? childColumn : claimNextColumn(state);
}

/**
 * Walks first-parent from each head sha through the supplied rows and returns the set of
 * shas that are part of any of those chains. Use this to compute `pinnedShas` for the
 * layout.
 *
 * Rows must be in the same order the layout will process them (topological / date order).
 */
// Param widened to the structural minimum this reads (sha + parents) so callers can pass their
// own row shape without allocating a projected copy — the body never touches `kind`.
export function identifyFirstParentChain(
	rows: readonly { sha: Sha; parents: readonly Sha[] }[],
	headShas: readonly Sha[],
): Set<Sha> {
	const chain = new Set<Sha>();
	if (headShas.length === 0) return chain;

	// `remaining` holds the next-expected sha for each in-flight chain (seeded with the heads). As a
	// Set it naturally unions chains that converge on a shared ancestor: walking rows in order, each
	// row that matches is added to the chain and replaced by its own first parent.
	const remaining = new Set<Sha>(headShas);
	for (const row of rows) {
		if (!remaining.has(row.sha)) continue;

		chain.add(row.sha);
		remaining.delete(row.sha);
		const firstParent = row.parents[0];
		if (firstParent) {
			remaining.add(firstParent);
		}
	}

	return chain;
}

/**
 * Collect every sha reachable (via the full parent DAG, not just first-parent) from any of the given
 * tip shas, within the loaded rows. Used for webview-side branches-visibility / hidden-ref filtering:
 * a commit is visible iff it is an ancestor of at least one visible ref tip.
 *
 * Tips not present in the loaded rows are skipped (their history hasn't paged in yet). The walk is a
 * plain DFS over `parents`, so it is O(rows + edges) and independent of row order.
 */
export function collectReachable(
	rows: readonly { sha: Sha; parents: readonly Sha[] }[],
	tipShas: Iterable<Sha>,
): Set<Sha> {
	const parentsBySha = new Map<Sha, readonly Sha[]>();
	for (const row of rows) {
		parentsBySha.set(row.sha, row.parents);
	}

	const reachable = new Set<Sha>();
	const stack: Sha[] = [];
	for (const tip of tipShas) {
		stack.push(tip);
	}
	while (stack.length > 0) {
		const sha = stack.pop()!;
		if (reachable.has(sha)) continue;

		const parents = parentsBySha.get(sha);
		if (parents === undefined) continue; // tip/ancestor not loaded yet

		reachable.add(sha);
		for (const parent of parents) {
			if (!reachable.has(parent)) {
				stack.push(parent);
			}
		}
	}

	return reachable;
}

/**
 * Assign each pinned branch head with a distinct lane its own stack column. Walks the heads in order
 * and hands each one the NEXT dense column (0, 1, 2, …), tagging its first-parent chain with that
 * column and stopping at a commit already claimed by an EARLIER head — so shared ancestors stay on the
 * lower lane. A head that hasn't loaded (not in `rows`) or whose tip is already owned by an earlier
 * head reserves NO column (and doesn't advance the counter), so the assigned columns stay gap-free and
 * no empty phantom lane is held. Pass the heads base-first so the shared base/trunk lands on column 0.
 *
 * Rows must be in the same order the layout will process them (topological / date order). The result
 * is the `pinnedShas` → per-commit column map the layout consumes, plus the sha → owning-head map
 * (`tipBySha`) that lets a pinned-lane row resolve its own ghost-ref tip (pinned lanes never open a
 * `SegmentBuilder`, so they'd otherwise be invisible to `segmentByCommit`).
 */
export function assignPinnedColumns(
	rows: readonly { sha: Sha; parents: readonly Sha[] }[],
	pinnedHeadShas: readonly Sha[],
): { columns: Map<Sha, number>; tipBySha: Map<Sha, Sha> } {
	const columns = new Map<Sha, number>();
	const tipBySha = new Map<Sha, Sha>();
	if (pinnedHeadShas.length === 0) return { columns: columns, tipBySha: tipBySha };

	const bySha = new Map<Sha, { parents: readonly Sha[] }>();
	for (const row of rows) {
		bySha.set(row.sha, row);
	}

	let nextColumn = 0;
	for (const head of pinnedHeadShas) {
		// A head not in the loaded window, or one already owned by an earlier (lower-column) head, has no
		// distinct lane — skip it without consuming a column so the layout reserves no empty phantom lane.
		if (!bySha.has(head) || columns.has(head)) continue;

		const col = nextColumn++;
		let cur: Sha | undefined = head;
		let safety = rows.length + 1;
		while (cur != null && safety-- > 0) {
			// Reached a commit owned by a lower-column head → it (and everything below) is that head's lane.
			if (columns.has(cur)) break;

			columns.set(cur, col);
			tipBySha.set(cur, head);
			cur = bySha.get(cur)?.parents?.[0];
		}
	}

	return { columns: columns, tipBySha: tipBySha };
}

/**
 * Core single-row column assignment. Direct port of GKC's `getColumns` (GraphContainer.tsx:4428)
 * with class-state lifted into the `state` parameter.
 */
function assignColumnForRow(state: LayoutState, row: GraphRow): number {
	// Release columns that were waiting on this row to finish using them. Each freed column
	// closes its in-progress segment (if any) with `forkSha = row.sha`.
	const toFree = state.columnsToFreeWhenFound.get(row.sha);
	if (toFree !== undefined) {
		for (const col of toFree) {
			const builder = state.segmentByColumn.get(col);
			if (builder !== undefined) {
				const segment = finalizeSegment(builder, row.sha);
				if (segment !== null) {
					state.finalizedSegments.push(segment);
				}
				state.segmentByColumn.delete(col);
			}
			state.columnsUsed.delete(col);
		}
		state.columnsToFreeWhenFound.delete(row.sha);
	}

	// If a child already reserved this row's column, use it.
	const ownReservation = state.reserverInfoBySha.get(row.sha);
	const pinnedColumn = state.pinnedColumns.get(row.sha);

	let column: number;
	let isOwnRowFreshClaim = false;
	if (pinnedColumn !== undefined) {
		column = pinnedColumn;
		state.columnsUsed.add(column);
		state.reserverInfoBySha.delete(row.sha);
	} else if (ownReservation?.column !== undefined) {
		column = ownReservation.column;
		state.reserverInfoBySha.delete(row.sha);
	} else {
		column = claimNextColumn(state);
		isOwnRowFreshClaim = true;
	}

	// Open a new segment when this row claims its column directly (an unmerged head, or
	// the topmost row in the layout). `mergeSha` is null because no merge commit reserved
	// this column on the row's behalf.
	if (isOwnRowFreshClaim) {
		state.segmentByColumn.set(column, { column: column, mergeSha: null, commitShas: [] });
	}

	// Append this row to whichever segment is tracking its column. Includes the just-opened
	// own-row case above, and any inherited / reserved column.
	const tracker = state.segmentByColumn.get(column);
	if (tracker !== undefined) {
		tracker.commitShas.push(row.sha);
	}

	const rowDate = Number.isFinite(row.date) ? row.date! : 0;

	for (let index = 0; index < row.parents.length; index++) {
		const parentSha = row.parents[index];

		// Asks the parent COUNT, not the row's kind. The two agreed while `kind` was re-derived from the
		// count, but they are different questions: this bookkeeping is about parent EDGES, and a row can
		// be a merge commit with a single loaded edge (first-parent mode truncates a merge's parents while
		// still labelling it `merge`). Keying on the label there would flag a row's only parent
		// merge-owned and cost the trunk its lane. Counting also covers a multi-parent stash, which the
		// label never could.
		if (row.parents.length > 1) {
			state.hasMergeNodeChildBySha.add(parentSha);
		}

		const parentReservation = state.reserverInfoBySha.get(parentSha);

		if (index === 0 && parentReservation?.column !== undefined && parentReservation.column !== column) {
			// Conflict: first-parent already reserved a different column. Either replace the
			// reservation (if this row has a "stronger" claim) or schedule the other column to
			// be freed when the parent is reached.
			const pendingFrees = state.columnsToFreeWhenFound.get(parentSha) ?? [];
			// Needs an own reservation: the test is "MY lane is newer than the stash holding my parent's
			// column". A fresh claim has none, and the old `?? 0` default made that vacuous case fire on any
			// negative (pre-1970) stash date.
			const stashReserved =
				ownReservation !== undefined &&
				parentReservation.kind === 'stash' &&
				row.kind !== 'stash' &&
				ownReservation.newestDate > parentReservation.newestDate;

			if ((parentReservation.column > column || stashReserved) && canReplaceReservation(state, row, parentSha)) {
				state.reserverInfoBySha.set(parentSha, {
					kind: row.kind,
					newestDate: ownReservation?.newestDate ?? rowDate,
					column: column,
				});
				pendingFrees.push(parentReservation.column);
			} else {
				pendingFrees.push(column);
			}
			state.columnsToFreeWhenFound.set(parentSha, pendingFrees);
		} else if (parentReservation?.column === undefined) {
			const isParentPinned = state.pinnedColumns.has(parentSha);

			const parentColumn = pickParentColumn(state, parentSha, index, column);
			state.reserverInfoBySha.set(parentSha, {
				kind: row.kind,
				newestDate: ownReservation?.column === column ? (ownReservation?.newestDate ?? rowDate) : rowDate,
				column: parentColumn,
			});

			// An additional parent (index > 0) on a non-pinned column is a genuine branch-off
			// event: this row is the merge-back point and `parentColumn` is the lane the branch
			// will occupy. Open a segment whose tip we'll learn when the parent (or a descendant
			// reservation chain off it) actually lands on the column.
			if (index > 0 && !isParentPinned) {
				state.segmentByColumn.set(parentColumn, {
					column: parentColumn,
					mergeSha: row.sha,
					commitShas: [],
				});
			}
		}
	}

	// A merge node's children flag clears on the row itself once it's been placed (it only
	// needed to carry reservation-conflict info while walking older rows).
	state.hasMergeNodeChildBySha.delete(row.sha);

	return column;
}

// Opaque resume token — a deep-cloned engine state captured at a row boundary so a later
// `appendColumnsAndSegments` can continue the forward pass over freshly-paged (older) rows without
// re-processing the whole loaded set. Callers hold it verbatim and pass it back; the shape is private.
declare const layoutSnapshotBrand: unique symbol;
export type GraphLayoutSnapshot = { readonly [layoutSnapshotBrand]: true };
interface InternalLayoutSnapshot {
	state: LayoutState;
	processedCount: number;
}

// Deep-copy the mutable engine state so a snapshot is immune to later mutation (and each append can
// clone-then-continue from the same snapshot repeatedly). `pinnedColumns` is a ReadonlyMap that is only
// non-empty when a branch is pinned — the resumable path is scoped to the unpinned case, so it's shared.
function cloneLayoutState(s: LayoutState): LayoutState {
	const columnsToFreeWhenFound = new Map<Sha, number[]>();
	for (const [k, v] of s.columnsToFreeWhenFound) {
		columnsToFreeWhenFound.set(k, v.slice());
	}
	const reserverInfoBySha = new Map<Sha, ReserverInfo>();
	for (const [k, v] of s.reserverInfoBySha) {
		reserverInfoBySha.set(k, { ...v });
	}
	const segmentByColumn = new Map<number, SegmentBuilder>();
	for (const [k, b] of s.segmentByColumn) {
		segmentByColumn.set(k, { column: b.column, mergeSha: b.mergeSha, commitShas: b.commitShas.slice() });
	}
	return {
		columnsUsed: new Set(s.columnsUsed),
		columnsToFreeWhenFound: columnsToFreeWhenFound,
		reserverInfoBySha: reserverInfoBySha,
		hasMergeNodeChildBySha: new Set(s.hasMergeNodeChildBySha),
		pinnedColumns: s.pinnedColumns,
		pinnedColumnCount: s.pinnedColumnCount,
		pinnedTipByCommit: s.pinnedTipByCommit,
		segmentByColumn: segmentByColumn,
		// Shallow copy ON PURPOSE: a finalized segment is immutable (only live BUILDERS mutate, and
		// those are deep-copied above), so the elements can be shared. Preserving segment identity
		// across appends is load-bearing — consumers diff segments by reference to re-index only the
		// changed ones — and it drops an O(total) deep copy per page-in.
		finalizedSegments: s.finalizedSegments.slice(),
	};
}

// Derive the render-facing outputs (drained segments + still-unloaded parent columns) from a state
// WITHOUT mutating it — so the snapshot taken from the same state stays valid (pre-drain). Mirrors the
// end-of-pass finalization in `computeColumnsAndSegments`.
function finalizeLayout(state: LayoutState): {
	segments: LaneSegment[];
	unloadedColumns: Map<Sha, number>;
	pinnedTipByCommit: ReadonlyMap<Sha, Sha>;
} {
	const segments = state.finalizedSegments.slice();
	for (const builder of state.segmentByColumn.values()) {
		const seg = finalizeSegment(builder, null);
		if (seg !== null) {
			segments.push(seg);
		}
	}
	const unloadedColumns = new Map<Sha, number>();
	for (const [sha, info] of state.reserverInfoBySha) {
		unloadedColumns.set(sha, info.column);
	}
	return { segments: segments, unloadedColumns: unloadedColumns, pinnedTipByCommit: state.pinnedTipByCommit };
}

// Assign columns for a slice of rows into `output`, threading `state` forward (the core of both the
// full pass and an incremental append).
function assignColumnsInto(state: LayoutState, rows: readonly GraphRow[], output: ProcessedGraphRow[]): void {
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		const column = assignColumnForRow(state, row);
		output[i] = {
			// Copy only canonical topology. Callers may pass a rich GraphCommit superset; spreading it
			// here would duplicate message/ref/context payload into the engine plane at every row.
			sha: row.sha,
			parents: row.parents,
			kind: row.kind,
			date: Number.isFinite(row.date) ? row.date : 0,
			column: column,
			edges: {},
			edgeColumnMax: 0,
		};
	}
}

/**
 * Continue the lane-allocation pass from a prior {@link GraphLayoutSnapshot} over freshly-paged rows
 * (older commits appended at the bottom). Returns ONLY the newly-processed rows plus the FULL segment /
 * unloaded-column state and a new snapshot. Byte-identical to a full recompute over the combined set,
 * because the engine keeps reserved columns stable across paging — asserted by the append-equivalence
 * tests. Scoped to the unpinned, unscoped, pure-append case; callers fall back to a full run otherwise.
 */
export function appendColumnsAndSegments(
	snapshot: GraphLayoutSnapshot,
	newRows: readonly GraphRow[],
): {
	rows: ProcessedGraphRow[];
	segments: readonly LaneSegment[];
	unloadedColumns: ReadonlyMap<Sha, number>;
	pinnedTipByCommit: ReadonlyMap<Sha, Sha>;
	snapshot: GraphLayoutSnapshot;
} {
	const prior = snapshot as unknown as InternalLayoutSnapshot;
	const state = cloneLayoutState(prior.state);
	const output: ProcessedGraphRow[] = new Array(newRows.length);
	assignColumnsInto(state, newRows, output);
	const nextSnapshot: InternalLayoutSnapshot = {
		state: state,
		processedCount: prior.processedCount + newRows.length,
	};
	const { segments, unloadedColumns, pinnedTipByCommit } = finalizeLayout(state);
	return {
		rows: output,
		segments: segments,
		unloadedColumns: unloadedColumns,
		pinnedTipByCommit: pinnedTipByCommit,
		snapshot: nextSnapshot as unknown as GraphLayoutSnapshot,
	};
}

/**
 * Run the lane-allocation pass over all rows. Returns a parallel array of
 * `ProcessedGraphRow` with `column` set (and empty `edges`/`edgeColumnMax` placeholders
 * that the edge pass will fill in).
 *
 * Rows MUST be newest-first AND every child MUST precede its parents — `--date-order`, `--topo-order` and
 * `--author-date-order` all guarantee this (the GitLens provider passes `--date-order`), and it is what GKC's
 * GraphContainer assumes. Feeding a parent above its own loaded child breaks the pass: the child mints a
 * reservation for an already-placed commit that nothing ever consumes, and it surfaces in `unloadedColumns`
 * as a dangling lane for a commit that is very much loaded.
 */
// KEPT deliberately despite having no in-repo production caller: this is the low-level escape hatch
// `engine/process.js` documents for a consumer that already holds `GraphRow[]` and wants columns
// without segments. Its own tests are the only callers today — do not read that as dead.
export function computeColumns(
	rows: readonly GraphRow[],
	options?: { pinnedShas?: readonly Sha[] },
): ProcessedGraphRow[] {
	return computeColumnsAndSegments(rows, options).rows;
}

/**
 * Same as `computeColumns` but also returns the lane segments identified during the pass.
 * A "lane segment" is a contiguous run of commits on a single column between when the
 * column was claimed and when it was freed (or end-of-rows for open segments). Used by
 * the renderer to power lane-collapse.
 *
 * Segments with fewer than two placed commits are dropped — there's nothing to fold.
 */
export function computeColumnsAndSegments(
	rows: readonly GraphRow[],
	options?: { pinnedShas?: readonly Sha[] },
): {
	rows: ProcessedGraphRow[];
	segments: readonly LaneSegment[];
	unloadedColumns: ReadonlyMap<Sha, number>;
	/** sha → owning pinned head sha, for pinned-lane ghost-ref resolution (empty when nothing pinned). */
	pinnedTipByCommit: ReadonlyMap<Sha, Sha>;
	// Resume token to continue this pass over freshly-paged rows via `appendColumnsAndSegments`. Valid
	// only for the unpinned case (an append can't retro-extend pinned chains); ignore it when pinned.
	snapshot: GraphLayoutSnapshot;
} {
	// `pinnedShas` is the ORDERED list of branch heads to pin to successive columns (0, 1, 2, …); expand
	// it to a per-commit column map (each head's first-parent chain; shared ancestors keep the lower lane).
	const { columns: pinnedColumns, tipBySha: pinnedTipByCommit } = assignPinnedColumns(
		rows,
		options?.pinnedShas ?? [],
	);
	let pinnedColumnCount = 0;
	for (const c of pinnedColumns.values()) {
		if (c + 1 > pinnedColumnCount) {
			pinnedColumnCount = c + 1;
		}
	}
	const state = createState(pinnedColumns, pinnedColumnCount, pinnedTipByCommit);

	const output: ProcessedGraphRow[] = new Array(rows.length);
	assignColumnsInto(state, rows, output);

	// Snapshot the state BEFORE finalization (which is a pure derivation, so the shared state stays a
	// valid pre-drain resume point). See the append-equivalence tests for the correctness guarantee.
	const snapshot: InternalLayoutSnapshot = { state: state, processedCount: rows.length };
	// Segments still open at end-of-rows (fork point below the loaded window) drain with `forkSha=null`;
	// reservations still present belong to parents that never loaded — surfaced so the edge pass can draw
	// a dangling stub down each held lane. The column is held deliberately for paging stability: re-running
	// with the parent loaded reserves the same column, so the lane doesn't shift when more history pages in.
	const { segments, unloadedColumns, pinnedTipByCommit: finalPinnedTipByCommit } = finalizeLayout(state);

	return {
		rows: output,
		segments: segments,
		unloadedColumns: unloadedColumns,
		pinnedTipByCommit: finalPinnedTipByCommit,
		snapshot: snapshot as unknown as GraphLayoutSnapshot,
	};
}
