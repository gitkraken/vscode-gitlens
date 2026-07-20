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
