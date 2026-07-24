import type { Sha } from './types.js';

/**
 * Build the reverse-topology map: sha → the shas of every commit that lists it as a parent.
 *
 * Single O(n) pass over the rows: for each row, push its sha onto each of its parents' children
 * arrays. Because rows arrive in git-log order (children above parents), iterating top-to-bottom
 * means each children array ends up ordered top-to-bottom — the child nearest the parent is last.
 */
// Param widened to the structural minimum this reads (sha + parents) so callers can pass their own
// row shape without allocating a projected copy.
export function buildChildrenBySha(rows: readonly { sha: Sha; parents: readonly Sha[] }[]): Map<Sha, Sha[]> {
	const childrenBySha = new Map<Sha, Sha[]>();
	for (const row of rows) {
		for (const parent of row.parents) {
			let children = childrenBySha.get(parent);
			if (children === undefined) {
				children = [];
				childrenBySha.set(parent, children);
			}
			children.push(row.sha);
		}
	}
	return childrenBySha;
}

/**
 * Walk `fromSha`'s own lane lineage (same-column hops) and return the nearest "branching point" —
 * a commit that has at least one child on a DIFFERENT column (a fork point where another branch
 * splits off). `dir === 1` walks DOWN toward parents (older); `dir === -1` walks UP toward children
 * (newer). This ports the old GKGraph engine's branching-point navigation exactly — it is NOT a
 * merge-commit scan.
 *
 * Returns `undefined` when `fromSha` isn't loaded, or when the walk can't move off `fromSha` (no
 * lineage step, or the very first step lands nowhere). The stop condition is only checked on each
 * NEWLY reached commit, so starting ON a branching point keeps walking to the next one.
 */
// Rows param widened to the structural minimum this reads (sha + parents + column). `indexBySha`
// maps sha → its index into `rows`; `childrenBySha` is `buildChildrenBySha`'s output.
export function findBranchingPointSha(
	rows: readonly { sha: Sha; parents: readonly Sha[]; column: number }[],
	indexBySha: ReadonlyMap<Sha, number>,
	childrenBySha: ReadonlyMap<Sha, readonly Sha[]>,
	fromSha: Sha,
	dir: 1 | -1,
): Sha | undefined {
	if (!indexBySha.has(fromSha)) return undefined;

	const rowOf = (sha: Sha): { sha: Sha; parents: readonly Sha[]; column: number } | undefined => {
		const i = indexBySha.get(sha);
		return i !== undefined ? rows[i] : undefined;
	};

	// A commit is a branching point when a loaded child sits on a different lane than it does.
	const isBranchingPoint = (sha: Sha): boolean => {
		const children = childrenBySha.get(sha);
		if (children == null || children.length === 0) return false;

		const col = rowOf(sha)?.column;
		if (col === undefined) return false;

		for (const child of children) {
			const r = rowOf(child);
			if (r != null && r.column !== col) return true;
		}
		return false;
	};

	// Down step: prefer a parent on the same lane; else fall back to the first LOADED parent (any lane).
	const getSameColumnParent = (sha: Sha): Sha | undefined => {
		const row = rowOf(sha);
		if (row == null || row.parents.length === 0) return undefined;

		const col = row.column;
		for (const p of row.parents) {
			if (rowOf(p)?.column === col) return p;
		}
		for (const p of row.parents) {
			if (rowOf(p) != null) return p;
		}
		return undefined;
	};

	// Up step: prefer a child on the same lane; else fall back to a child whose FIRST parent is this
	// commit (its first-parent successor — not merely any child that lists it as a parent).
	const getSameColumnChild = (sha: Sha): Sha | undefined => {
		const children = childrenBySha.get(sha);
		if (children == null || children.length === 0) return undefined;

		const col = rowOf(sha)?.column;
		if (col !== undefined) {
			for (const child of children) {
				if (rowOf(child)?.column === col) return child;
			}
		}
		for (const child of children) {
			if (rowOf(child)?.parents[0] === sha) return child;
		}
		return undefined;
	};

	const step = dir === 1 ? getSameColumnParent : getSameColumnChild;
	let sha = fromSha;
	// Bounded by row count so a pathological cycle can't spin forever.
	let guard = rows.length;
	while (guard-- > 0) {
		const next = step(sha);
		if (next == null) break;

		sha = next;
		if (isBranchingPoint(sha)) break;
	}
	return sha === fromSha ? undefined : sha;
}

/**
 * Collect the shas that lie on the same lane as each seed — the commits that visually belong to one
 * branch. Walks first-parent DOWN (older) while the parent stays on the seed's column, and — when
 * `direction` is `'both'` — same-column children UP (newer) toward the lane tip. The walk stops at the
 * fork/merge boundary: the first-parent link whose parent sits on ANOTHER column re-enters that lane, so
 * that parent (the merge base) is deliberately NOT included. Multiple seeds union naturally — e.g. a
 * local head and the remote it tracks, each the tip of its own lane.
 *
 * `'down'` is right for a REF seed (the ref IS the lane tip, so nothing newer belongs to it); `'both'`
 * is right for a mid-lane ROW seed ("the branch this commit is on"). Trunk has no cross-column first
 * parent, so a trunk seed walks all the way to the root — the whole mainline, by design.
 */
// Rows param widened to the structural minimum this reads (sha + parents + column). `indexBySha` maps
// sha → its index into `rows`; `childrenBySha` is `buildChildrenBySha`'s output.
export function collectLaneChain(
	rows: readonly { sha: Sha; parents: readonly Sha[]; column: number }[],
	indexBySha: ReadonlyMap<Sha, number>,
	childrenBySha: ReadonlyMap<Sha, readonly Sha[]>,
	seedShas: Iterable<Sha>,
	direction: 'down' | 'both',
): Set<Sha> {
	const chain = new Set<Sha>();

	const rowOf = (sha: Sha): { sha: Sha; parents: readonly Sha[]; column: number } | undefined => {
		const i = indexBySha.get(sha);
		return i !== undefined ? rows[i] : undefined;
	};

	// Down step: the first parent, taken only while it stays on this commit's column. A cross-column
	// first parent is the fork point — the lane ends here and that parent belongs to the other lane.
	const sameColumnParent = (sha: Sha): Sha | undefined => {
		const row = rowOf(sha);
		const parent = row?.parents[0];
		if (row == null || parent == null) return undefined;

		return rowOf(parent)?.column === row.column ? parent : undefined;
	};

	// Up step: the child whose FIRST parent is this commit AND that sits on the same column — its
	// same-lane successor toward the tip. A merge on another lane lists this commit as a (non-first)
	// parent, so the first-parent + column guards exclude it.
	const sameColumnChild = (sha: Sha): Sha | undefined => {
		const row = rowOf(sha);
		const children = row != null ? childrenBySha.get(sha) : undefined;
		if (row == null || children == null) return undefined;

		for (const child of children) {
			const c = rowOf(child);
			if (c != null && c.column === row.column && c.parents[0] === sha) return child;
		}
		return undefined;
	};

	const guard = rows.length;
	for (const seed of seedShas) {
		if (rowOf(seed) == null || chain.has(seed)) continue;

		// Down from the seed (older) — stops at the fork point.
		let sha: Sha | undefined = seed;
		let steps = guard;
		while (sha != null && steps-- > 0) {
			if (chain.has(sha)) break;

			chain.add(sha);
			sha = sameColumnParent(sha);
		}

		// Up from the seed (newer) — only for a row seed; a ref seed is already the tip.
		if (direction === 'both') {
			sha = sameColumnChild(seed);
			steps = guard;
			while (sha != null && steps-- > 0) {
				if (chain.has(sha)) break;

				chain.add(sha);
				sha = sameColumnChild(sha);
			}
		}
	}

	return chain;
}
