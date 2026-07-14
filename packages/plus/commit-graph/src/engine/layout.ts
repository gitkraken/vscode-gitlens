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

/** A column some not-yet-placed sha will claim via its sticky preference, and the row it claims at. */
interface PendingNeed {
	column: number;
	row: number;
	consumed: boolean;
}

/** One column's pending claims, ascending by row, with a lazily-advanced head that drops spent entries. */
interface NeedQueue {
	needs: PendingNeed[];
	head: number;
}

/** The pending preference claims a fallback lane must not steal — see {@link makeScratchFactory}. */
interface PendingNeeds {
	/** Live (unspent) need count — once it hits 0 both readers short-circuit for the rest of the pass. */
	pending: number;
	bySha: Map<Sha, PendingNeed>;
	/** Indexed by column. A dense ARRAY, not a Map: `nextNeedRow` runs inside the column-scan loop of every
	 *  fallback claim, and columns are small dense ints, so an indexed load beats hashing on the hot path. */
	byColumn: (NeedQueue | undefined)[];
}

/** A fresh lane whose first parent is ALREADY reserved: it provably dies at that parent's row. */
interface LaneBound {
	/** `undefined` unless the parent's reservation is REPLACEABLE — see {@link claimNextColumn}. */
	minColumn: number | undefined;
	/** The first parent — its row is where this lane's column is released. Resolved to an index only on the
	 *  fallback path, so a claim that lands on its preference never touches the scratch. */
	firstParent: Sha;
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
	/** In-progress segment builders, keyed by current column index. */
	segmentByColumn: Map<number, SegmentBuilder>;
	/** Finalized segments — appended on column-free, drained at the end of the layout pass. */
	finalizedSegments: LaneSegment[];
	/** sha → the column it occupied in a PRIOR run (sticky-column hint). Fresh claims prefer it when
	 *  free, so an unchanged region reproduces its prior layout across a top insertion — which keeps
	 *  lane colors stable on updates and lets consumers splice the unchanged suffix by identity.
	 *  Purely an allocation preference: any internally-consistent assignment is a valid layout. */
	preferredColumns?: ReadonlyMap<Sha, number>;
	/** Builds {@link scratch} on first use; undefined on preference-less runs (nothing to protect). */
	scratchFactory?: (state: LayoutState) => LayoutScratch;
	/** Memoized sticky scratch. Read ONLY on the fallback-scan path — see {@link getScratch}. */
	scratch?: LayoutScratch;
	/** Index of the row being assigned — needs at earlier rows are already consumed or stale. */
	currentRow: number;
}

function createState(
	pinnedColumns: ReadonlyMap<Sha, number>,
	pinnedColumnCount: number,
	preferredColumns?: ReadonlyMap<Sha, number>,
): LayoutState {
	return {
		columnsUsed: new Set(),
		columnsToFreeWhenFound: new Map(),
		reserverInfoBySha: new Map(),
		hasMergeNodeChildBySha: new Set(),
		pinnedColumns: pinnedColumns,
		pinnedColumnCount: pinnedColumnCount,
		segmentByColumn: new Map(),
		finalizedSegments: [],
		preferredColumns: preferredColumns,
		currentRow: 0,
	};
}

/** Sticky-run scratch — see {@link makeScratchFactory}. */
interface LayoutScratch {
	rowIndexBySha: Map<Sha, number>;
	pendingNeeds: PendingNeeds;
}

/**
 * Build the sticky scratch LAZILY — this is the engine's hot path, and the work is pure insurance that a
 * steady-state relayout never needs.
 *
 * Two structures, both O(rows) to build and both string-keyed (the expensive kind):
 *
 *  • `rowIndexBySha` — resolves a bounded lane's RELEASE ROW (where its column frees).
 *  • `pendingNeeds` — the preference claims still ahead of the pass, so a fallback claim can take a low free
 *    column without stealing one a known sha is going to want. Only two kinds of sha ever consult a
 *    preference (i.e. reach {@link claimNextColumn}): a window TIP — nothing above it named it as a parent,
 *    so no child reserved its column — and an ADDITIONAL (index > 0) parent of a merge, which claims at the
 *    MERGE's row. Every other column comes from a reservation or a pinned column, and every reservation's
 *    column originates in an earlier claim, so those two sets are complete.
 *
 * Neither is read unless a claim FALLS THROUGH to the column scan, and on a relayout of a mostly-unchanged
 * graph almost every claim lands on its preference instead. So we hand the state a factory and build on
 * first miss: the common update pays nothing, and a run with no preferences at all never even gets a factory.
 */
function makeScratchFactory(
	rows: readonly GraphRow[],
	preferredColumns: ReadonlyMap<Sha, number>,
	pinnedColumns: ReadonlyMap<Sha, number>,
	pinnedColumnCount: number,
): (state: LayoutState) => LayoutScratch {
	return (state: LayoutState): LayoutScratch => {
		// One walk for both: the row index, plus the set of shas some row names as a parent — those get a
		// RESERVATION rather than a claim, so they never consult a preference.
		const rowIndexBySha = new Map<Sha, number>();
		const hasChild = new Set<Sha>();
		for (let i = 0; i < rows.length; i++) {
			const row = rows[i];
			rowIndexBySha.set(row.sha, i);
			for (const parent of row.parents) {
				hasChild.add(parent);
			}
		}

		const bySha = new Map<Sha, PendingNeed>();
		const byColumn: (NeedQueue | undefined)[] = [];
		let pending = 0;
		const add = (sha: Sha, atRow: number): void => {
			if (bySha.has(sha) || pinnedColumns.has(sha)) return;

			// A preference below the pinned range is unusable (a claim never lands there) — no guard needed.
			const column = preferredColumns.get(sha);
			if (column === undefined || column < pinnedColumnCount) return;

			// Building MID-PASS: a sha already holding a reservation has had its column decided and will never
			// consult its preference, so its need is born spent. (A tip already placed is covered by the row
			// check in `nextNeedRow` — its need row is behind us.)
			const consumed = state.reserverInfoBySha.has(sha);
			const need: PendingNeed = { column: column, row: atRow, consumed: consumed };
			bySha.set(sha, need);
			if (!consumed) {
				pending++;
			}

			const queue = byColumn[column];
			if (queue !== undefined) {
				queue.needs.push(need);
			} else {
				byColumn[column] = { needs: [need], head: 0 };
			}
		};

		// Separate walk — `hasChild` is only final once the first one finishes. Row order in, so each column's
		// queue comes out ascending by row: no sort needed.
		for (let i = 0; i < rows.length; i++) {
			const row = rows[i];
			if (!hasChild.has(row.sha)) {
				add(row.sha, i);
			}

			for (let index = 1; index < row.parents.length; index++) {
				add(row.parents[index], i);
			}
		}

		return { rowIndexBySha: rowIndexBySha, pendingNeeds: { pending: pending, bySha: bySha, byColumn: byColumn } };
	};
}

/**
 * Parents whose lane is already continued by a child that OWNS a prior column — so it is not up for grabs
 * by a brand-new row hanging off the same parent. Only ever built when some row lacks a preference (i.e. the
 * graph actually changed), so a steady-state relayout skips it.
 */
function computeSpokenForLanes(rows: readonly GraphRow[], preferredColumns: ReadonlyMap<Sha, number>): Set<Sha> {
	const spokenFor = new Set<Sha>();
	for (const row of rows) {
		const firstParent = row.parents[0];
		if (firstParent != null && preferredColumns.has(row.sha)) {
			spokenFor.add(firstParent);
		}
	}

	return spokenFor;
}

/** The scratch, built on first use. `undefined` when the run has no preferences to protect. */
function getScratch(state: LayoutState): LayoutScratch | undefined {
	if (state.scratch === undefined && state.scratchFactory !== undefined) {
		state.scratch = state.scratchFactory(state);
	}
	return state.scratch;
}

/** Mark a sha's pending preference claim satisfied — it can never consult its preference again. */
function consumeNeed(state: LayoutState, sha: Sha): void {
	// Runs once per reservation (i.e. per parent edge) — reads the scratch ONLY if something already built it,
	// so it never forces the build, and bails before hashing the sha once every need is spent. A sha reserved
	// BEFORE a mid-pass build is marked spent by the factory itself.
	const needs = state.scratch?.pendingNeeds;
	if (needs === undefined || needs.pending === 0) return;

	const need = needs.bySha.get(sha);
	if (need !== undefined && !need.consumed) {
		need.consumed = true;
		needs.pending--;
	}
}

/** Row at which the next still-pending preference claim on `column` lands (`Infinity` when there is none). */
function nextNeedRow(needs: PendingNeeds | undefined, currentRow: number, column: number): number {
	if (needs === undefined || needs.pending === 0) return Infinity;

	const bucket = needs.byColumn[column];
	if (bucket === undefined) return Infinity;

	while (bucket.head < bucket.needs.length) {
		const need = bucket.needs[bucket.head];
		// A need whose row is behind us belongs to a sha that has already claimed — drop it, or it would
		// block its column for the rest of the pass.
		if (!need.consumed && need.row >= currentRow) return need.row;

		bucket.head++;
	}

	return Infinity;
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
 * Pick the next unused column for a non-pinned commit. Scanning starts ABOVE the reserved pinned
 * columns (`pinnedColumnCount`) so a fresh lane never collides with a pinned-branch lane. (Same as
 * GKC's `getAvailableColumnAndUseIt`, generalized from a single reserved column to N.)
 *
 * A claim with no usable preference can't just grab the lowest free column — two hazards bound it:
 *   • the STEAL — taking a column a known sha will claim via ITS preference displaces that sha and
 *     cascades a lane renumber through the otherwise-unchanged region (`pendingNeeds` guards it);
 *   • the DRAG — landing BELOW a REPLACEABLE first-parent reservation trips the reservation-replace
 *     path in `assignColumnForRow`, pulling the parent's whole first-parent chain (e.g. the trunk)
 *     onto this lane (`bound.minColumn` / the unbounded preference floor guard it).
 * Both are bounded per-claim rather than globally, so a lane that dies quickly — a WIP row, whose
 * column is freed one row later at its anchor — still packs in next to its parent instead of parking
 * out past every other lane in the window.
 */
function claimNextColumn(state: LayoutState, forSha?: Sha, bound?: LaneBound): number {
	if (forSha !== undefined) {
		consumeNeed(state, forSha);
	}

	const base = state.pinnedColumnCount;

	// Fast path: the sha's prior-run column, when free. This REPRODUCES the prior layout — including any
	// reservation-replace that layout triggered — so it is a fixpoint and needs no guarding.
	const preferred = forSha !== undefined ? state.preferredColumns?.get(forSha) : undefined;
	if (preferred !== undefined && preferred >= base && !state.columnsUsed.has(preferred)) {
		state.columnsUsed.add(preferred);
		return preferred;
	}

	// Fallback — the only path on which a claim can perturb a layout someone else is relying on, so the only
	// one that gets guarded, and the first point at which the scratch is worth building. A preference-less
	// run (cold open, paging append) has no prior layout to cascade into, so it stays a plain lowest-free
	// scan — which is what lets a claim pull its first parent's chain down onto a lower lane and lay the
	// graph out more compactly. Guarding that would only widen a cold graph for nothing.
	const scratch = getScratch(state);
	let floor = base;
	let releaseRow = Infinity;
	if (scratch !== undefined) {
		if (bound !== undefined) {
			// Sit above a REPLACEABLE parent reservation, or the replace path drags the parent's chain here.
			floor = Math.max(base, bound.minColumn ?? 0);
			releaseRow = scratch.rowIndexBySha.get(bound.firstParent) ?? Infinity;
		} else if (preferred !== undefined) {
			// An inherited preference is where this lane's first-parent chain rejoins the graph — landing
			// below it would drag that chain here just the same.
			floor = Math.max(base, preferred + 1);
		}
	}

	let column = floor;
	// Skip a column some known sha will claim via ITS preference BEFORE this lane frees — taking it would
	// displace that sha and cascade a renumber. Frees run ahead of claims in `assignColumnForRow`, so a need
	// landing exactly ON the release row is safe: hence the strict `<`.
	while (state.columnsUsed.has(column) || nextNeedRow(scratch?.pendingNeeds, state.currentRow, column) < releaseRow) {
		column += 1;
	}
	state.columnsUsed.add(column);
	return column;
}

/**
 * Whether the conflict branch in {@link assignColumnForRow} could move `parentSha`'s reservation onto this
 * row's lane — dragging the parent's whole first-parent chain with it. SINGLE SOURCE OF TRUTH: the branch
 * itself gates on this, and {@link claimNextColumn}'s drag guard reads it one phase EARLIER (before the
 * parents loop) to decide whether a fresh claim must sit above the parent's column. Keeping one predicate
 * is what stops the guard and the guarded path from silently drifting apart.
 *
 * A merge row is excluded because it flags every parent as merge-owned at the top of the parents loop, so
 * by the time the branch runs it can never move its own first parent — but at claim time that flag isn't
 * set yet, and reading it there would needlessly widen a merge tip's lane.
 */
function canReplaceReservation(state: LayoutState, row: GraphRow, parentSha: Sha): boolean {
	return row.kind !== 'merge' && !state.hasMergeNodeChildBySha.has(parentSha) && !state.pinnedColumns.has(parentSha);
}

/**
 * Pick the column for a parent commit. A pinned parent lands on its assigned stack column; the first
 * parent inherits its child's column; additional parents claim a fresh column above the pinned lanes.
 */
function pickParentColumn(state: LayoutState, parentSha: Sha, parentIndex: number, childColumn: number): number {
	const pinned = state.pinnedColumns.get(parentSha);
	if (pinned !== undefined) return pinned;
	return parentIndex === 0 ? childColumn : claimNextColumn(state, parentSha);
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
 * is the `pinnedShas` → per-commit column map the layout consumes.
 */
export function assignPinnedColumns(
	rows: readonly { sha: Sha; parents: readonly Sha[] }[],
	pinnedHeadShas: readonly Sha[],
): Map<Sha, number> {
	const columns = new Map<Sha, number>();
	if (pinnedHeadShas.length === 0) return columns;

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
			cur = bySha.get(cur)?.parents?.[0];
		}
	}

	return columns;
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
		// This lane dies at its first parent whenever that parent's column is already settled — either it
		// holds a RESERVATION, or (sticky only) it OWNS a prior column, in which case the parents loop below
		// refuses to drag it here and the lane ends there instead. Knowing that, the claim can pack into a
		// column that other lanes only need further down. See `claimNextColumn`.
		let bound: LaneBound | undefined;
		const firstParent = row.parents[0];
		if (firstParent !== undefined) {
			const parentReservation = state.reserverInfoBySha.get(firstParent);
			if (parentReservation !== undefined) {
				bound = {
					minColumn: canReplaceReservation(state, row, firstParent)
						? parentReservation.column + 1
						: undefined,
					firstParent: firstParent,
				};
			} else if (state.preferredColumns?.get(firstParent) !== undefined) {
				// No reservation to drag, so no drag guard — just the release row.
				bound = { minColumn: undefined, firstParent: firstParent };
			}
		}
		column = claimNextColumn(state, row.sha, bound);
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

	const rowDate = row.date ?? 0;

	for (let index = 0; index < row.parents.length; index++) {
		const parentSha = row.parents[index];

		if (row.kind === 'merge') {
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
			// negative (pre-1970) stash date — replacing the reservation out from under a bounded claim and
			// voiding its release row.
			const stashReserved =
				ownReservation !== undefined &&
				parentReservation.kind === 'stash' &&
				row.kind !== 'stash' &&
				ownReservation.newestDate > parentReservation.newestDate;

			// A parent already sitting on the lane it OWNS is not up for grabs — the same ownership rule the
			// no-reservation path enforces below. Without it that path stops a lane owner being dragged while
			// THIS one still yanks it off, so a fetch that displaces anything shifts lanes again on the next
			// relayout instead of settling: the layout stops being a fixpoint.
			const parentOwnsItsColumn = state.preferredColumns?.get(parentSha) === parentReservation.column;

			if (
				!parentOwnsItsColumn &&
				(parentReservation.column > column || stashReserved) &&
				canReplaceReservation(state, row, parentSha)
			) {
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

			// A first parent that OWNS a prior lane, on a row that is NOT on that lane, must not be dragged
			// here: handing it this row's column pulls its whole first-parent chain — usually the trunk — onto
			// a displaced lane, and the conflict branch above cannot undo it (it refuses to move a
			// merge-flagged parent, and trunk commits are merge parents constantly). Reserve nothing: this
			// lane simply ends at the parent, and the parent's own chain reclaims its column further down.
			if (index === 0 && !isParentPinned && state.preferredColumns !== undefined) {
				const parentPreferred = state.preferredColumns.get(parentSha);
				if (parentPreferred !== undefined && parentPreferred !== column) {
					const pendingFrees = state.columnsToFreeWhenFound.get(parentSha) ?? [];
					pendingFrees.push(column);
					state.columnsToFreeWhenFound.set(parentSha, pendingFrees);
					continue;
				}
			}

			const parentColumn = pickParentColumn(state, parentSha, index, column);
			state.reserverInfoBySha.set(parentSha, {
				kind: row.kind,
				newestDate: ownReservation?.column === column ? (ownReservation?.newestDate ?? rowDate) : rowDate,
				column: parentColumn,
			});
			// Reserved now, so it will never reach `claimNextColumn` — release its column guard. (A
			// first-parent inherit doesn't go through `claimNextColumn`, so this is the only consume site
			// for it; an additional parent consumed its own need inside `pickParentColumn`'s claim.)
			consumeNeed(state, parentSha);

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
		segmentByColumn: segmentByColumn,
		// Shallow copy ON PURPOSE: a finalized segment is immutable (only live BUILDERS mutate, and
		// those are deep-copied above), so the elements can be shared. Preserving segment identity
		// across appends is load-bearing — consumers diff segments by reference to re-index only the
		// changed ones — and it drops an O(total) deep copy per page-in.
		finalizedSegments: s.finalizedSegments.slice(),
		// Pass-local scratch is NEVER carried across the snapshot: it is row-index-based (an append restarts
		// indexes at 0) and its `consumed` flags / bucket heads are mutable, so sharing it would let two
		// clones of one snapshot corrupt each other. Dropping it here rather than at the call sites makes the
		// deep-copy contract self-enforcing — and keeps the O(n) maps off the per-page-in copy entirely.
		preferredColumns: undefined,
		scratchFactory: undefined,
		scratch: undefined,
		currentRow: 0,
	};
}

// Derive the render-facing outputs (drained segments + still-unloaded parent columns) from a state
// WITHOUT mutating it — so the snapshot taken from the same state stays valid (pre-drain). Mirrors the
// end-of-pass finalization in `computeColumnsAndSegments`.
function finalizeLayout(state: LayoutState): { segments: LaneSegment[]; unloadedColumns: Map<Sha, number> } {
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
	return { segments: segments, unloadedColumns: unloadedColumns };
}

// Assign columns for a slice of rows into `output`, threading `state` forward (the core of both the
// full pass and an incremental append).
function assignColumnsInto(state: LayoutState, rows: readonly GraphRow[], output: ProcessedGraphRow[]): void {
	for (let i = 0; i < rows.length; i++) {
		state.currentRow = i;
		const column = assignColumnForRow(state, rows[i]);
		output[i] = { ...rows[i], column: column, edges: {}, edgeColumnMax: 0 };
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
	snapshot: GraphLayoutSnapshot;
} {
	const prior = snapshot as unknown as InternalLayoutSnapshot;
	// The clone drops all pass-local scratch, so appended (older) rows carry no preferences and simply claim
	// the lowest free column. The bound/min rules read only cloned reservation state, so a full recompute and
	// an append still agree — see the append-equivalence tests.
	const state = cloneLayoutState(prior.state);
	const output: ProcessedGraphRow[] = new Array(newRows.length);
	assignColumnsInto(state, newRows, output);
	const nextSnapshot: InternalLayoutSnapshot = {
		state: state,
		processedCount: prior.processedCount + newRows.length,
	};
	const { segments, unloadedColumns } = finalizeLayout(state);
	return {
		rows: output,
		segments: segments,
		unloadedColumns: unloadedColumns,
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
 * as a dangling lane for a commit that is very much loaded. Consumers that feed those columns back as
 * `preferredColumns` must let a real row's column win the tie (see `gl-lit-graph`'s `recomputeRows`), or that
 * phantom ratchets the lane space by one on every update.
 */
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
	options?: {
		pinnedShas?: readonly Sha[];
		/** Sticky-column hints from a prior run (sha → column). Fresh claims prefer them when free,
		 *  so an unchanged region reproduces its prior layout across a top insertion. */
		preferredColumns?: ReadonlyMap<Sha, number>;
	},
): {
	rows: ProcessedGraphRow[];
	segments: readonly LaneSegment[];
	unloadedColumns: ReadonlyMap<Sha, number>;
	// Resume token to continue this pass over freshly-paged rows via `appendColumnsAndSegments`. Valid
	// only for the unpinned case (an append can't retro-extend pinned chains); ignore it when pinned.
	snapshot: GraphLayoutSnapshot;
} {
	// `pinnedShas` is the ORDERED list of branch heads to pin to successive columns (0, 1, 2, …); expand
	// it to a per-commit column map (each head's first-parent chain; shared ancestors keep the lower lane).
	const pinnedColumns = assignPinnedColumns(rows, options?.pinnedShas ?? []);
	let pinnedColumnCount = 0;
	for (const c of pinnedColumns.values()) {
		if (c + 1 > pinnedColumnCount) {
			pinnedColumnCount = c + 1;
		}
	}
	// Inherit sticky-column preferences down FIRST-PARENT chains (bottom-up, so parents resolve
	// first): a brand-new tip has no preference of its own, but its chain continues an existing
	// lane — without inheritance the tip parks on a fresh lane and its first-parent RESERVATIONS
	// drag the entire chain (e.g. the trunk) there, shifting every row below.
	let preferredColumns = options?.preferredColumns;
	if (preferredColumns != null && preferredColumns.size > 0) {
		// Copy-on-first-write: a relayout of an unchanged graph has a preference for every row already, so
		// eagerly copying the map (n string-keyed entries — a third of the whole pass at 100k rows) buys
		// nothing. Take the copy only when a brand-new sha actually inherits something. `spokenFor` is built
		// on the same terms — a steady-state relayout never reaches it.
		let effective: Map<Sha, number> | undefined;
		let spokenFor: ReadonlySet<Sha> | undefined;
		let current: ReadonlyMap<Sha, number> = preferredColumns;
		for (let i = rows.length - 1; i >= 0; i--) {
			const row = rows[i];
			if (current.has(row.sha)) continue;

			const firstParent = row.parents[0];
			if (firstParent == null) continue;

			// Only ONE row can continue a lane. If a child that already OWNS a prior column continues this
			// parent, the lane is spoken for and a brand-new row hanging off the same parent must NOT inherit
			// it — a fetched branch tip forking off the trunk would otherwise "prefer" the trunk's own column,
			// win it (it sorts newest, so it claims first), and evict the trunk onto a far-right lane.
			spokenFor ??= computeSpokenForLanes(rows, preferredColumns);
			if (spokenFor.has(firstParent)) continue;

			const inherited = current.get(firstParent);
			if (inherited === undefined) continue;

			if (effective === undefined) {
				effective = new Map(preferredColumns);
				current = effective;
			}
			effective.set(row.sha, inherited);
		}
		if (effective !== undefined) {
			preferredColumns = effective;
		}
	}
	const state = createState(pinnedColumns, pinnedColumnCount, preferredColumns);

	// Preference-less runs (a cold open, every paging append) get no factory at all: with nothing to
	// reproduce, their claims already take the lowest free column, so the scratch could not change an outcome.
	if (preferredColumns != null && preferredColumns.size > 0) {
		state.scratchFactory = makeScratchFactory(rows, preferredColumns, pinnedColumns, pinnedColumnCount);
	}

	const output: ProcessedGraphRow[] = new Array(rows.length);
	assignColumnsInto(state, rows, output);
	// Pass-local state — dropped before the snapshot below retains THIS state object (it is not cloned), or
	// the resume token would pin the n-entry maps (and the factory's closure over `rows`) for the lifetime of
	// the loaded graph.
	state.preferredColumns = undefined;
	state.scratchFactory = undefined;
	state.scratch = undefined;
	state.currentRow = 0;

	// Snapshot the state BEFORE finalization (which is a pure derivation, so the shared state stays a
	// valid pre-drain resume point). See the append-equivalence tests for the correctness guarantee.
	const snapshot: InternalLayoutSnapshot = { state: state, processedCount: rows.length };
	// Segments still open at end-of-rows (fork point below the loaded window) drain with `forkSha=null`;
	// reservations still present belong to parents that never loaded — surfaced so the edge pass can draw
	// a dangling stub down each held lane. The column is held deliberately for paging stability: re-running
	// with the parent loaded reserves the same column, so the lane doesn't shift when more history pages in.
	const { segments, unloadedColumns } = finalizeLayout(state);

	return {
		rows: output,
		segments: segments,
		unloadedColumns: unloadedColumns,
		snapshot: snapshot as unknown as GraphLayoutSnapshot,
	};
}
