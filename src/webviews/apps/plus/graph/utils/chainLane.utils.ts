import type { ProcessedGraphRow } from '@gitkraken/commit-graph/engine/types.js';

/**
 * How far a run's highlight reaches PAST `endIndex`, toward its fork point (the first parent of the row
 * at `endIndex`) — see `computeChainLaneRuns`'s doc comment for the walk that decides between these.
 *
 * `'fork'` — the fork row is reachable and every intermediate row's pass-through art at the run's column
 * carries the link to it, so the highlight can draw the full elbow into the fork's own column.
 *
 * `'clamp'` — the engine's art doesn't lead all the way to the fork (a lane can be reassigned mid-flight),
 * so the highlight extends only as far as continuous art exists: a taller vertical stub reaching the TOP
 * of the first row where continuity breaks, with no elbow — there's nothing to elbow INTO.
 */
export type ChainLaneExtension =
	| { kind: 'fork'; forkIndex: number; forkColumn: number }
	| { kind: 'clamp'; clampIndex: number };

/**
 * One contiguous same-column run of a ref chain (pinned or Ctrl-hold) across DISPLAY rows — the space
 * the virtualizer renders (`indexBySha`/`displayRows` in gl-lit-graph.ts), not the engine's processed
 * rows. `startIndex`/`endIndex` are display-row indices, inclusive.
 *
 * `collectLaneChain` (engine navigation.ts) only steps same-column, so a chain's shas resolve to at
 * most one run per column (pin seeds give up to two: local + remote upstream) — a column's min/max
 * display index is a valid single run by construction.
 */
export type ChainLaneRun = {
	column: number;
	startIndex: number;
	endIndex: number;
	extension?: ChainLaneExtension;
};

/**
 * Reduces a ref chain's shas to the vertical runs the chain-lane highlight draws — one bright rule per
 * run, painted outside the rows' own opacity so it stays visible through dimmed rows.
 *
 * Shas missing from `indexBySha` (hidden behind a collapsed lane or filtered out) are skipped. Workdir
 * rows are skipped too — the WIP row connects via a dotted edge, not a lane, so a solid rule would
 * overdraw it (the row itself still undims via the chain set, unrelated to this overlay).
 */
export function computeChainLaneRuns(
	chain: ReadonlySet<string>,
	indexBySha: ReadonlyMap<string, number>,
	rows: readonly ProcessedGraphRow[],
): ChainLaneRun[] {
	const boundsByColumn = new Map<number, { startIndex: number; endIndex: number }>();

	for (const sha of chain) {
		const index = indexBySha.get(sha);
		if (index == null) continue;

		const row = rows[index];
		if (row == null || row.kind === 'workdir') continue;

		const bounds = boundsByColumn.get(row.column);
		if (bounds == null) {
			boundsByColumn.set(row.column, { startIndex: index, endIndex: index });
		} else {
			if (index < bounds.startIndex) {
				bounds.startIndex = index;
			}

			if (index > bounds.endIndex) {
				bounds.endIndex = index;
			}
		}
	}

	const runs: ChainLaneRun[] = [];
	for (const [column, bounds] of boundsByColumn) {
		if (bounds.endIndex === bounds.startIndex) continue;

		const run: ChainLaneRun = { column: column, startIndex: bounds.startIndex, endIndex: bounds.endIndex };
		const extension = computeChainLaneExtension(run, indexBySha, rows);
		if (extension != null) {
			run.extension = extension;
		}

		runs.push(run);
	}

	return runs;
}

/**
 * Extends a run past its last chained row toward its fork point, IF the engine's own lane art actually
 * leads there — see `ChainLaneExtension`'s doc comment for the three outcomes.
 *
 * `undefined` (no extension) when: the run's last row has no first parent (a root); the parent isn't in
 * `indexBySha` (paged/loaded outside the current window); the parent's row isn't strictly below (this
 * shouldn't happen — display rows walk newest-first — but a display glitch shouldn't draw upward); or the
 * parent shares the run's column (`collectLaneChain` only stops at a DIFFERENT column, so a same-column
 * "fork" here means the walk should already have continued through it — treated defensively, not drawn).
 */
function computeChainLaneExtension(
	run: Pick<ChainLaneRun, 'column' | 'endIndex'>,
	indexBySha: ReadonlyMap<string, number>,
	rows: readonly ProcessedGraphRow[],
): ChainLaneExtension | undefined {
	const forkSha = rows[run.endIndex]?.parents[0];
	if (forkSha == null) return undefined;

	const forkIndex = indexBySha.get(forkSha);
	if (forkIndex == null || forkIndex <= run.endIndex) return undefined;

	const forkRow = rows[forkIndex];
	if (forkRow == null || forkRow.column === run.column) return undefined;

	// The gap between the last chained row and the fork row: the engine bakes the SAME cross-column link
	// into every intermediate row's pass-through art at the run's column (laneClamp.ts's
	// `computeGutterGeometry`) — a bright rule can't run over a column with no art under it, so the first
	// row that doesn't carry it clamps the reach right there (kind doesn't matter: a WIP/interleaved row
	// in the gap is fine as long as it still carries the pass-through).
	for (let i = run.endIndex + 1; i < forkIndex; i++) {
		if (rows[i]?.edges[run.column]?.passThrough?.parentSha !== forkSha) {
			return { kind: 'clamp', clampIndex: i };
		}
	}

	return { kind: 'fork', forkIndex: forkIndex, forkColumn: forkRow.column };
}
