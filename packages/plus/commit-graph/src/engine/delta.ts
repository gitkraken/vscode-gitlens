/**
 * Rows-change classification for the incremental pipeline.
 *
 * The renderer receives a fresh rows array on every host push (IPC deserialization mints new
 * objects), so identity says nothing about WHAT changed. This classifier compares the engine-
 * relevant TOPOLOGY of each row — sha, parents, type, date: exactly the fields that feed layout
 * and edge computation — and names the change so each downstream derivation can do proportional
 * work instead of a full rebuild:
 *
 * - `initial`  — no prior rows; run the full pipeline.
 * - `append`   — prior rows are an unchanged topology prefix and new rows follow (paging in older
 *                history); the engine resumes from its snapshot and derivations patch the tail.
 * - `payload`  — same topology, row for row; only payload (refs, message, author, stats) may
 *                differ. Layout/edges/segments are provably unchanged — skip the engine entirely.
 * - `replace`  — anything else (prefix changed, truncated, reordered); full recompute.
 *
 * A WIP row's anchor move shows up as a parents change ⇒ `replace`, which is correct: the row's
 * lane placement depends on that parent.
 */

/** The engine-relevant identity of a consumer row (what `toGraphCommit` feeds the layout). */
export interface RowTopology {
	sha: string;
	parents: readonly string[];
	type?: string;
	date?: number;
}

export type RowsDelta =
	| { kind: 'initial' }
	| { kind: 'append'; firstNewIndex: number }
	| { kind: 'payload' }
	| { kind: 'replace' };

function topologyEquals(a: RowTopology, b: RowTopology): boolean {
	if (a.sha !== b.sha || a.type !== b.type || a.date !== b.date) return false;

	const ap = a.parents;
	const bp = b.parents;
	if (ap.length !== bp.length) return false;

	for (let i = 0; i < ap.length; i++) {
		if (ap[i] !== bp[i]) return false;
	}
	return true;
}

/**
 * Classify `next` against `prior`. O(prior) field compares — far cheaper than any recompute this
 * classification lets a caller skip, and exact: every compared field feeds the engine, so `append`
 * and `payload` can never false-positive into a stale layout.
 */
export function classifyRowsDelta<T extends RowTopology>(
	prior: readonly T[] | undefined,
	next: readonly T[],
): RowsDelta {
	if (prior == null || prior.length === 0) return { kind: 'initial' };
	if (next.length < prior.length) return { kind: 'replace' };

	for (let i = 0; i < prior.length; i++) {
		if (!topologyEquals(prior[i], next[i])) return { kind: 'replace' };
	}

	return next.length > prior.length ? { kind: 'append', firstNewIndex: prior.length } : { kind: 'payload' };
}
