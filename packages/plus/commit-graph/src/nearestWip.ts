import type { Sha } from './engine/types.js';

/**
 * Minimum row shape the WIP search reads — a sha plus its parent links. Consumers pass their own row
 * type; any superset works.
 */
export interface WipSearchRow {
	sha: Sha;
	parents?: readonly Sha[];
}

/** Map of commit sha → the column (lane) index it was laid out in. */
export type ColumnNumberBySha = Readonly<Record<Sha, number>>;

/**
 * Minimum WIP-metadata shape the search reads — each WIP row's first-parent anchor, keyed by the WIP
 * row's own sha. Consumers pass their own metadata record; any superset works.
 */
export type WipMetadataBySha = Readonly<Record<Sha, { readonly parentSha?: Sha }>>;

export interface WipCandidate {
	sha: Sha;
	anchor: Sha;
	/**
	 * True for the host's PRIMARY working-changes row — the one the caller falls back to when no WIP
	 * matches. Host-supplied because the primary's sha is a host sentinel the engine doesn't know.
	 * Wins every tie-break, so the picked WIP never depends on metadata iteration order.
	 */
	primary?: boolean;
}

/**
 * Picks the WIP to jump to for the clicked commit, using lane (column) as the primary signal.
 *
 * Rules, in order:
 *  1. **Exact-anchor match.** If a WIP's anchor IS the clicked commit (the user clicked
 *     directly on a branch's tip that has a WIP attached), return that WIP — regardless of
 *     column. Captures "I clicked the tip of this branch, take me to its working changes."
 *  2. **Nearest above, in the lane.** Among WIPs whose anchor renders in the same column as the
 *     clicked commit and sits at-or-above it, pick the one whose anchor is NEAREST. An anchor
 *     above the click in its own lane is a checkout whose state CONTAINS the clicked commit, and
 *     the nearest such anchor is the most specific container — the working changes that sit
 *     directly on top of this commit rather than a broader branch further up the same lane.
 *     Membership is tested on the ANCHOR's column, which is the lane the user reads the WIP as
 *     belonging to — the WIP row usually lands in that same lane, but layout gives it one of its
 *     own when the anchor's column is already reserved, so its own column is not a reliable signal.
 *  3. **Otherwise → undefined.** Caller falls back to the primary WIP. No attempt to pick
 *     across lanes — clicking a commit on an unrelated lane shouldn't trigger a jump to a
 *     branch in a different visual lane.
 *
 * Returns undefined when `columnsBySha` is missing entirely or when `fromSha`'s column isn't
 * yet known (column data hasn't been computed for the clicked row). The caller should fall
 * through to a non-column-aware strategy in that case.
 */
export function findWipInColumn(
	fromSha: Sha,
	rows: readonly WipSearchRow[] | undefined,
	primary: WipCandidate | undefined,
	wipMetadataBySha: WipMetadataBySha | undefined,
	columnsBySha: ColumnNumberBySha | undefined,
): Sha | undefined {
	if (rows == null || rows.length === 0) return undefined;
	if (columnsBySha == null) return undefined;

	const fromColumn = columnsBySha[fromSha];
	if (fromColumn == null) return undefined;

	const rowIndexBySha = new Map<Sha, number>();
	for (let i = 0; i < rows.length; i++) {
		rowIndexBySha.set(rows[i].sha, i);
	}
	const fromIndex = rowIndexBySha.get(fromSha);
	if (fromIndex == null) return undefined;

	// Build the WIP list. Primary first so it wins exact-anchor ties (extremely unlikely
	// — git doesn't let two worktrees share a HEAD — but kept for symmetry with iteration
	// order of the column-distance loop below).
	const wips: WipCandidate[] = [];
	if (primary != null) {
		wips.push(primary);
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

	// Rule 2: among same-column WIPs whose anchor is at-or-above the click, pick the one NEAREST
	// (smallest row distance). Every candidate here is a checkout that CONTAINS the clicked commit
	// — it's in that anchor's history — so the choice is which container the user means, and the
	// nearest one is the most specific: the working changes sitting directly on top of this commit,
	// not a broader branch further up the same lane.
	//
	// Filters:
	// - **Column**: an anchor whose column isn't yet in `columnsBySha` (columns are emitted only
	//   for visible rows, or haven't been recomputed after a fresh secondary load) is treated as
	//   "lane unknown — keep" rather than silently dropped, so partial-column-load doesn't
	//   lose valid in-lane WIPs.
	// - **Above-only**: a WIP whose anchor is BELOW (older than) the click means the branch
	//   tip is past the click — the click can't be in that branch's history. Skip.
	let best: { sha: Sha; distance: number; primary?: boolean } | undefined;
	for (const wip of wips) {
		const anchorColumn = columnsBySha[wip.anchor];
		if (anchorColumn != null && anchorColumn !== fromColumn) continue;

		const anchorIndex = rowIndexBySha.get(wip.anchor);
		if (anchorIndex == null) continue;
		if (anchorIndex > fromIndex) continue;

		const distance = fromIndex - anchorIndex;
		if (
			best == null ||
			distance < best.distance ||
			(distance === best.distance &&
				preferOver(wip, { sha: best.sha, anchor: wip.anchor, primary: best.primary }))
		) {
			best = { sha: wip.sha, distance: distance, primary: wip.primary };
		}
	}

	return best?.sha;
}

/**
 * Stable tie-break for two WIP candidates with the same range/distance score. The primary WIP
 * always wins over a secondary; among two secondaries the lexicographically smaller `sha` wins.
 * Together these eliminate dependence on `wipMetadataBySha` insertion order — a host-side
 * re-ordering of the metadata object can't flip the picked WIP between renders for the same click.
 */
function preferOver(candidate: WipCandidate, current: WipCandidate): boolean {
	if (candidate.sha === current.sha) return false;
	if (candidate.primary) return true;
	if (current.primary) return false;
	return candidate.sha < current.sha;
}

/**
 * Defensive fallback for the brief window where the column map hasn't been published yet (e.g.
 * first paint after launch, immediately after a scope change). Walks each WIP's parent chain
 * looking for `fromSha` and picks the closest in BFS-ancestor distance. Without this, every
 * click during the column-load gap would blindly snap to the primary WIP.
 *
 * Falls back to the primary WIP if present in `wips`, else the first wip, when no candidate's
 * chain reaches `fromSha`. Returns undefined only when `wips` is empty.
 */
export function findNearestWipByAncestry(
	fromSha: Sha,
	wips: readonly WipCandidate[],
	rows: readonly WipSearchRow[] | undefined,
): Sha | undefined {
	if (wips.length === 0) return undefined;

	const rowsBySha = new Map<Sha, WipSearchRow>();
	if (rows != null) {
		for (const row of rows) {
			rowsBySha.set(row.sha, row);
		}
	}

	let best: { sha: Sha; distance: number } | undefined;
	for (const wip of wips) {
		const distance = bfsAncestorDistance(wip.anchor, fromSha, rowsBySha, rowsBySha.size);
		if (distance === -1) continue;

		if (best == null || distance < best.distance) {
			best = { sha: wip.sha, distance: distance };
		}
	}

	if (best != null) return best.sha;
	return wips.find(w => w.primary)?.sha ?? wips[0].sha;
}

function bfsAncestorDistance(
	start: Sha,
	target: Sha,
	rowsBySha: ReadonlyMap<Sha, WipSearchRow>,
	maxVisit: number,
): number {
	if (start === target) return 0;

	const visited = new Set<Sha>([start]);
	let frontier: Sha[] = [start];
	let distance = 0;
	while (frontier.length > 0 && visited.size <= maxVisit) {
		distance++;
		const next: Sha[] = [];
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
