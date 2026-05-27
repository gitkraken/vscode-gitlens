import type { ColumnNumberBySha, GraphRow, ReadonlyGraphRow } from '@gitkraken/gitkraken-components';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { GraphWipMetadataBySha } from '../../../../plus/graph/protocol.js';

type Row = GraphRow | ReadonlyGraphRow;

export interface WipCandidate {
	sha: string;
	anchor: string;
}

/**
 * Picks the WIP to jump to for the clicked commit, using lane (column) as the primary signal.
 *
 * Rules, in order:
 *  1. **Exact-anchor match.** If a WIP's anchor IS the clicked commit (the user clicked
 *     directly on a branch's tip that has a WIP attached), return that WIP — regardless of
 *     column. Captures "I clicked the tip of this branch, take me to its working changes."
 *  2. **Same column.** Among WIPs whose anchor renders in the same column as the clicked
 *     commit, pick the one whose anchor is closest by row distance. The WIP's own row column
 *     and its anchor's column are the same by construction (the synthetic WIP row inherits
 *     the anchor's lane), so anchor column is the canonical lane signal.
 *  3. **Otherwise → undefined.** Caller falls back to the primary WIP (`uncommitted`). No
 *     attempt to pick across lanes — clicking a commit on an unrelated lane shouldn't trigger
 *     a jump to a branch in a different visual lane.
 *
 * Returns undefined when `columnsBySha` is missing entirely or when `fromSha`'s column isn't
 * yet known (column data hasn't been computed for the clicked row). The caller should fall
 * through to a non-column-aware strategy in that case.
 */
export function findWipInColumn(
	fromSha: string,
	rows: readonly Row[] | undefined,
	primaryAnchor: string | undefined,
	wipMetadataBySha: GraphWipMetadataBySha | undefined,
	columnsBySha: ColumnNumberBySha | undefined,
): string | undefined {
	if (rows == null || rows.length === 0) return undefined;
	if (columnsBySha == null) return undefined;

	const fromColumn = columnsBySha[fromSha];
	if (fromColumn == null) return undefined;

	const rowIndexBySha = new Map<string, number>();
	for (let i = 0; i < rows.length; i++) {
		rowIndexBySha.set(rows[i].sha, i);
	}
	const fromIndex = rowIndexBySha.get(fromSha);
	if (fromIndex == null) return undefined;

	// Build the WIP list. Primary first so it wins exact-anchor ties (extremely unlikely
	// — git doesn't let two worktrees share a HEAD — but kept for symmetry with iteration
	// order of the column-distance loop below).
	const wips: WipCandidate[] = [];
	if (primaryAnchor != null) {
		wips.push({ sha: uncommitted, anchor: primaryAnchor });
	}
	if (wipMetadataBySha != null) {
		for (const [sha, meta] of Object.entries(wipMetadataBySha)) {
			if (meta.parentSha != null) {
				wips.push({ sha: sha, anchor: meta.parentSha });
			}
		}
	}

	// Rule 1: exact-anchor match. The clicked commit IS a branch's tip that has a WIP.
	// Iterate explicitly (instead of `wips.find`) so we can apply the deterministic tie-break
	// below — two metadata entries can legitimately share an anchor sha (e.g. a detached
	// secondary worktree pinned at the same commit as another worktree), and the picked WIP
	// must not depend on host-side `wipMetadataBySha` insertion order.
	let exact: WipCandidate | undefined;
	for (const wip of wips) {
		if (wip.anchor !== fromSha) continue;

		if (exact == null || preferOver(wip, exact)) {
			exact = wip;
		}
	}
	if (exact != null) return exact.sha;

	// Rule 2: among same-column WIPs whose anchor is at-or-above the click, pick the one
	// FARTHEST UP (largest row distance). The farthest-up tip in a shared column is the most
	// principal branch in that lane — typically `main` when many feature branches share its
	// first-parent chain without yet visually diverging. Closest-up was the wrong call: it
	// always landed on whichever feature branch had a tip newest above the click, even when
	// that feature is a side-extension of the lane's principal branch.
	//
	// Filters:
	// - **Column**: an anchor whose column isn't yet in `columnsBySha` (GK emits columns only
	//   for visible rows, or hasn't recomputed after a fresh secondary load) is treated as
	//   "lane unknown — keep" rather than silently dropped, so partial-column-load doesn't
	//   lose valid in-lane WIPs.
	// - **Above-only**: a WIP whose anchor is BELOW (older than) the click means the branch
	//   tip is past the click — the click can't be in that branch's history. Skip.
	let best: { sha: string; distance: number } | undefined;
	for (const wip of wips) {
		const anchorColumn = columnsBySha[wip.anchor];
		if (anchorColumn != null && anchorColumn !== fromColumn) continue;

		const anchorIndex = rowIndexBySha.get(wip.anchor);
		if (anchorIndex == null) continue;
		if (anchorIndex > fromIndex) continue;

		const distance = fromIndex - anchorIndex;
		if (
			best == null ||
			distance > best.distance ||
			(distance === best.distance && preferOver(wip, { sha: best.sha, anchor: wip.anchor }))
		) {
			best = { sha: wip.sha, distance: distance };
		}
	}

	return best?.sha;
}

/**
 * Stable tie-break for two WIP candidates with the same range/distance score. Primary
 * (`uncommitted`) always wins over a secondary; among two secondaries the lexicographically
 * smaller `sha` wins. Together these eliminate dependence on `wipMetadataBySha` insertion
 * order — a host-side re-ordering of the metadata object can't flip the picked WIP between
 * renders for the same click.
 */
function preferOver(candidate: WipCandidate, current: WipCandidate): boolean {
	if (candidate.sha === current.sha) return false;
	if (candidate.sha === uncommitted) return true;
	if (current.sha === uncommitted) return false;
	return candidate.sha < current.sha;
}

/**
 * Defensive fallback for the brief window where `onColumnsCalculated` hasn't fired yet (e.g.
 * first paint after launch, immediately after a scope change). Walks each WIP's parent chain
 * looking for `fromSha` and picks the closest in BFS-ancestor distance. Without this, every
 * click during the column-load gap would blindly snap to the primary WIP.
 *
 * Falls back to the primary WIP (`uncommitted`) if present in `wips`, else the first wip,
 * when no candidate's chain reaches `fromSha`. Returns undefined only when `wips` is empty.
 */
export function findNearestWipByAncestry(
	fromSha: string,
	wips: readonly WipCandidate[],
	rows: readonly Row[] | undefined,
): string | undefined {
	if (wips.length === 0) return undefined;

	const rowsBySha = new Map<string, Row>();
	if (rows != null) {
		for (const row of rows) {
			rowsBySha.set(row.sha, row);
		}
	}

	let best: { sha: string; distance: number } | undefined;
	for (const wip of wips) {
		const distance = bfsAncestorDistance(wip.anchor, fromSha, rowsBySha, rowsBySha.size);
		if (distance === -1) continue;

		if (best == null || distance < best.distance) {
			best = { sha: wip.sha, distance: distance };
		}
	}

	if (best != null) return best.sha;
	return wips.find(w => w.sha === uncommitted)?.sha ?? wips[0].sha;
}

function bfsAncestorDistance(
	start: string,
	target: string,
	rowsBySha: ReadonlyMap<string, Row>,
	maxVisit: number,
): number {
	if (start === target) return 0;

	const visited = new Set<string>([start]);
	let frontier: string[] = [start];
	let distance = 0;
	while (frontier.length > 0 && visited.size <= maxVisit) {
		distance++;
		const next: string[] = [];
		for (const sha of frontier) {
			const row = rowsBySha.get(sha);
			if (row == null) continue;

			for (const parent of row.parents ?? []) {
				if (visited.has(parent)) continue;
				if (parent === target) return distance;

				visited.add(parent);
				next.push(parent);
			}
		}
		frontier = next;
	}
	return -1;
}
