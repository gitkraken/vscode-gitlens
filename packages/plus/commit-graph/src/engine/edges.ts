/**
 * Edge state machine + hash cache for the commit-graph engine.
 *
 * The hash is the load-bearing perf optimization: the renderer memoizes rendered edge
 * elements by it, so rows with identical edge shapes skip reconciliation entirely. At 10k
 * commits only a handful of unique edge patterns actually exist.
 *
 * Framework-agnostic — the renderer walks the `RowEdges` structure directly to draw lanes.
 */

import type { Edge, EdgeByColumn, EdgeKind, ProcessedGraphRow, RowEdge, RowEdges, Sha } from './types.js';

/**
 * Kinds whose edges should render dashed (representing pending/incomplete state).
 */
function hasPendingChanges(kind: EdgeKind): boolean {
	return kind === 'workdir';
}

/**
 * Stable key for a child→parent link, used to mark edges that span commits hidden by a collapsed
 * lane. The collapse pass (which knows which parents were remapped over hidden commits) produces a
 * set of these keys; the edge state machine consults it to flag the matching starting edge
 * `spansHidden` so the renderer draws it dashed.
 */
export function collapsedLinkKey(childSha: Sha, parentSha: Sha): string {
	return `${childSha}\x00${parentSha}`;
}

// Edge state machine

/**
 * For the given row, derive which of the previous row's edges continue into this row —
 * either ending here (the edge's parent matches this row's sha) or passing through.
 *
 * Port of GKC's `getEndingAndPassThroughEdgesByColumnFromPrevRow`.
 */
function carryEdgesFromPrevRow(row: ProcessedGraphRow, prev: RowEdges): RowEdges {
	const result: RowEdges = {};

	for (const key of Object.keys(prev)) {
		const column = Number(key);
		const { passThrough, starting } = prev[column];

		let nextEdge: Edge | undefined;
		if (passThrough && !hasPendingChanges(passThrough.kind)) {
			nextEdge = passThrough;
		} else if (starting && !hasPendingChanges(starting.kind)) {
			nextEdge = starting;
		} else {
			nextEdge = passThrough ?? starting;
		}

		if (!nextEdge) continue;

		if (nextEdge.parentSha === row.sha) {
			result[column] = { ending: nextEdge };
		} else {
			result[column] = { passThrough: nextEdge };
		}
	}

	return result;
}

/**
 * For each of this row's parents, emit a starting edge at the column where the edge is
 * visually rooted: the first-parent rides the child's own column; additional parents
 * start from their reserved parent column.
 *
 * Port of GKC's `getStartingEdgesByColumn`. Accepts an optional `syntheticChildren` set
 * (scoped-graph mode) — any sha in that set emits synthetic-edge kind edges.
 */
function computeStartingEdges(
	row: ProcessedGraphRow,
	processedBySha: Record<Sha, ProcessedGraphRow>,
	syntheticChildren?: ReadonlySet<Sha>,
	collapsedLinks?: ReadonlySet<string>,
	unloadedColumns?: ReadonlyMap<Sha, number>,
): EdgeByColumn {
	const result: EdgeByColumn = {};
	const parents = row.parents;
	if (parents.length === 0) return result;

	const kind: EdgeKind = syntheticChildren?.has(row.sha) ? 'synthetic-edge' : row.kind;
	// `spansHidden` is set ONLY when the link is collapsed-spanning — kept off the edge entirely
	// otherwise so the common (no-collapse) edge object stays identical to before (no stray
	// `undefined` key on the hot path).
	const makeEdge = (parentSha: Sha): Edge => {
		const edge: Edge = { parentSha: parentSha, kind: kind };
		if (collapsedLinks?.has(collapsedLinkKey(row.sha, parentSha))) {
			edge.spansHidden = true;
		}
		return edge;
	};

	// First parent — edge roots at the child's own column.
	result[row.column] = makeEdge(parents[0]);

	// Additional parents — the edge roots at each parent's column: its real column when the parent is
	// loaded, else the column the layout reserved for it (`unloadedColumns`) so an unloaded parent draws
	// a dangling stub down that lane instead of leaving it empty. (First parents emit unconditionally
	// above; their unloaded case already dangles the same way.)
	for (let i = 1; i < parents.length; i++) {
		const parentSha = parents[i];
		const parentColumn = processedBySha[parentSha]?.column ?? unloadedColumns?.get(parentSha);
		// Skip when the column already carries a starting edge — the first parent (rooted at
		// `row.column`) or an earlier additional parent that resolved to the same lane. Two parents
		// sharing a column can only draw one edge; without this guard the later write silently drops
		// the first-parent / nearest-visible-ancestor lane (reachable via collapse parent-remapping).
		if (parentColumn !== undefined && result[parentColumn] === undefined) {
			result[parentColumn] = makeEdge(parentSha);
		}
	}

	return result;
}

/**
 * Full edge state for a single row: merges carry-over (ending/passthrough) with this
 * row's starting edges. Port of GKC's `getFinalEdgeStateForGraphAndRow`.
 */
function computeRowEdges(
	row: ProcessedGraphRow,
	prevEdges: RowEdges,
	processedBySha: Record<Sha, ProcessedGraphRow>,
	syntheticChildren?: ReadonlySet<Sha>,
	collapsedLinks?: ReadonlySet<string>,
	unloadedColumns?: ReadonlyMap<Sha, number>,
): RowEdges {
	const edges = carryEdgesFromPrevRow(row, prevEdges);
	const starting = computeStartingEdges(row, processedBySha, syntheticChildren, collapsedLinks, unloadedColumns);

	for (const key of Object.keys(starting)) {
		const column = Number(key);
		const existing: RowEdge = edges[column] ?? {};
		existing.starting = starting[column];
		edges[column] = existing;
	}

	return edges;
}

// Pick the edge `carryEdgesFromPrevRow` would carry forward from a column's bucket (same
// precedence: durable passThrough, then durable starting, then whatever exists).
function pickCarriedEdge(bucket: RowEdge): Edge | undefined {
	const { passThrough, starting } = bucket;
	if (passThrough && !hasPendingChanges(passThrough.kind)) return passThrough;
	if (starting && !hasPendingChanges(starting.kind)) return starting;
	return passThrough ?? starting;
}

/**
 * Whether two rows' edge states hand the SAME carry to the next row. Strict edge equality is too
 * strong for resume/splice boundary checks: `ending` edges are consumed at their row and never
 * propagate, so two states differing only in endings are carry-equivalent. Used by the collapse
 * filter's prefix-splice to prove the reused suffix would have been computed identically.
 */
export function carriedEdgesEqual(a: RowEdges, b: RowEdges): boolean {
	const columns = new Set<number>();
	for (const key of Object.keys(a)) {
		columns.add(Number(key));
	}
	for (const key of Object.keys(b)) {
		columns.add(Number(key));
	}

	for (const column of columns) {
		const ae = a[column] != null ? pickCarriedEdge(a[column]) : undefined;
		const be = b[column] != null ? pickCarriedEdge(b[column]) : undefined;
		if (ae === be) continue;
		if (ae == null || be == null) return false;
		if (ae.parentSha !== be.parentSha || ae.kind !== be.kind || ae.spansHidden !== be.spansHidden) return false;
	}
	return true;
}

/**
 * Highest column index with any edge in the row.
 */
function edgeColumnMax(edges: RowEdges): number {
	let max = 0;
	for (const key of Object.keys(edges)) {
		const column = Number(key);
		if (column > max) {
			max = column;
		}
	}
	return max;
}

/**
 * Drive the edge pass over every row in order. Mutates each row's `edges` and
 * `edgeColumnMax`. Returns the overall maximum column for convenience (used by the
 * renderer to size the gutter).
 */
export function computeEdges(
	rows: ProcessedGraphRow[],
	options?: {
		syntheticChildren?: ReadonlySet<Sha>;
		collapsedLinks?: ReadonlySet<string>;
		unloadedColumns?: ReadonlyMap<Sha, number>;
		// Carry-over edges from the last already-processed row, to continue the pass over freshly-paged
		// (older) rows. The appended rows' parents are always older (in this batch or unloaded), so a
		// batch-local `bySha` suffices; the dangling stubs handed over in `resumePrev` end at the right
		// appended row via the normal carry logic. Prior rows never need recomputation — the engine keeps
		// reserved columns stable, so their edges are already byte-identical to a full recompute.
		resumePrev?: RowEdges;
		/**
		 * Prefix-change splice: the caller layout-aligned `rows[nextStart..nextStart+reused)` against
		 * `prior[priorStart..priorStart+reused)` (identical sha/kind/date/parents/COLUMN, edges not yet
		 * computed). Once the walk reaches the aligned run AND the live carry projects identically to
		 * the carry that produced the prior row's edges, every subsequent aligned row's edges are
		 * byte-identical by induction — so the PRIOR row objects (edges included) are swapped in and
		 * their recomputation skipped. Rows past the aligned run (a grown bottom) resume the walk from
		 * the last adopted row's edges.
		 */
		splice?: {
			prior: readonly ProcessedGraphRow[];
			priorStart: number;
			nextStart: number;
			reused: number;
		};
	},
): { maxColumn: number; splicedFrom?: number } {
	let overallMax = 0;
	const bySha: Record<Sha, ProcessedGraphRow> = {};
	for (const row of rows) {
		bySha[row.sha] = row;
	}

	const splice = options?.splice;
	const spliceShift = splice != null ? splice.nextStart - splice.priorStart : 0;
	const spliceEnd = splice != null ? splice.nextStart + splice.reused : 0;
	let splicedFrom: number | undefined;

	let prev: RowEdges = options?.resumePrev ?? {};
	for (let i = 0; i < rows.length; i++) {
		// Carry convergence inside the aligned run → adopt the prior rows wholesale. The prior row's
		// own edges were produced from the carry stored on the row ABOVE it, so comparing projections
		// (endings are consumed and never propagate) proves the remaining aligned edges identical.
		if (splice != null && splicedFrom == null && i >= splice.nextStart && i < spliceEnd) {
			const priorAbove = splice.prior[i - spliceShift - 1];
			const priorCarry = priorAbove != null ? priorAbove.edges : {};
			if (carriedEdgesEqual(prev, priorCarry)) {
				splicedFrom = i;
				for (let j = i; j < spliceEnd; j++) {
					const adopted = splice.prior[j - spliceShift];
					rows[j] = adopted;
					bySha[adopted.sha] = adopted;
					if (adopted.edgeColumnMax > overallMax) {
						overallMax = adopted.edgeColumnMax;
					}
				}
				i = spliceEnd - 1;
				prev = rows[i].edges;
				continue;
			}
		}

		const row = rows[i];
		row.edges = computeRowEdges(
			row,
			prev,
			bySha,
			options?.syntheticChildren,
			options?.collapsedLinks,
			options?.unloadedColumns,
		);
		row.edgeColumnMax = edgeColumnMax(row.edges);
		if (row.edgeColumnMax > overallMax) {
			overallMax = row.edgeColumnMax;
		}
		prev = row.edges;
	}

	return { maxColumn: overallMax, splicedFrom: splicedFrom };
}

// Hashing (identical to GKC's buildEdgeHash)

export function buildStartingOrEndingEdgeHash(
	edgeColumn: number,
	nodeColumn: number,
	kind: EdgeKind | undefined,
	isCompact?: boolean,
): string {
	return `${edgeColumn}_${nodeColumn}_${kind ?? '+'}${isCompact ? '_c' : ''}`;
}

export function buildPassThroughEdgeHash(column: number, kind: EdgeKind | undefined, isCompact?: boolean): string {
	return `${column}_${kind ?? '+'}${isCompact ? '_c' : ''}`;
}

/**
 * Derive a compact string key identifying every visually-distinct aspect of a row's
 * edges. If two rows produce the same hash their rendered SVG is byte-identical, so the
 * renderer can look up a previously built SVG string in O(1).
 */
export function buildEdgeHash(edges: RowEdges, maxColumn: number, nodeColumn: number, isCompact?: boolean): string {
	let hash = '';
	// Integer-indexed iteration beats Object.keys — hot path.
	for (let column = 0; column <= maxColumn; column++) {
		const bucket = edges[column];
		const starting = bucket?.starting;
		const ending = bucket?.ending;
		const passThrough = bucket?.passThrough;
		// `spansHidden` (a loaded-but-folded link the renderer draws dashed) changes the stroke but NOT
		// the kind, so it must enter the hash — otherwise two rows with identical kinds memo to the same
		// (wrong) solid-vs-dashed SVG. Appended only when set, so the common no-collapse hash is unchanged.
		// Build the token only when a flag is set — the common no-collapse case skips the allocation.
		let span = '';
		if (starting?.spansHidden || ending?.spansHidden || passThrough?.spansHidden) {
			span = `${starting?.spansHidden ? 's' : ''}${ending?.spansHidden ? 'e' : ''}${passThrough?.spansHidden ? 'p' : ''}`;
		}
		hash = `${hash}_${buildStartingOrEndingEdgeHash(
			column,
			nodeColumn,
			starting?.kind,
			isCompact,
		)}_${buildStartingOrEndingEdgeHash(
			column,
			nodeColumn,
			ending?.kind,
			isCompact,
		)}_${buildPassThroughEdgeHash(column, passThrough?.kind, isCompact)}${span ? `_${span}` : ''}`;
	}
	return hash;
}

// Exports used only by tests (internal helpers that deserve direct coverage)

export const __test = {
	carryEdgesFromPrevRow: carryEdgesFromPrevRow,
	computeStartingEdges: computeStartingEdges,
	computeRowEdges: computeRowEdges,
	edgeColumnMax: edgeColumnMax,
};
