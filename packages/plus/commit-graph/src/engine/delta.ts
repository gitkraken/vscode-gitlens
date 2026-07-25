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

/** Rows whose topology legitimately mutates WITHOUT a history rewrite: a work-dir (WIP) row's parent
 *  tracks HEAD, so it moves on every ordinary commit; stash rows can be re-dated. Neither can tell a
 *  rewrite from a prepend, so {@link isHistoryRewrite} compares the immutable commit rows only. */
function isImmutableRow(row: RowTopology): boolean {
	return row.type !== 'work-dir-changes' && row.type !== 'stash-node';
}

/**
 * Distinguishes the two shapes `classifyRowsDelta` lumps into `replace`: a HISTORY REWRITE (rebase,
 * amend, squash, a reset that drops commits) versus an ordinary PREPEND (a new/fetched commit on top,
 * older rows unchanged below). Sticky-column preferences (`stableFrom`) are a valid, stable fixpoint
 * only across a prepend — a rewrite changes surviving commits' DAG roles, so reproducing their prior
 * columns can drag lanes to the wrong column (and the area-based renormalize backstop can't catch an
 * equal-area misroute). Callers should drop `stableFrom` (lay out cold, == reopening) when this is true.
 *
 * A prepend has the prior commit rows reappear as a contiguous, in-order run inside `next` — shifted
 * down by the new tips, with the bottom optionally trimmed by the window cap. So: find the prior top
 * commit in `next`; if it's gone its sha was rewritten (rewrite), otherwise verify the prior commits
 * align from there with identical topology (a first mismatch = a mid-window rewrite). WIP/stash rows
 * are excluded (see {@link isImmutableRow}). O(n).
 */
export function isHistoryRewrite<T extends RowTopology>(prior: readonly T[] | undefined, next: readonly T[]): boolean {
	if (prior == null || prior.length === 0) return false;

	const priorCommits = prior.filter(isImmutableRow);
	if (priorCommits.length === 0) return false;

	const nextCommits = next.filter(isImmutableRow);

	// Anchor on the prior top commit; a real commit sha is unique, so this can't mis-match. Its absence
	// from the fresh commits means that sha was rewritten.
	const k = nextCommits.findIndex(r => r.sha === priorCommits[0].sha);
	if (k < 0) return true;

	for (let i = 0; i < priorCommits.length; i++) {
		const n = nextCommits[k + i];
		if (n == null) break; // prior bottom trimmed off by the window cap — still a clean prepend
		if (!topologyEquals(priorCommits[i], n)) return true;
	}
	return false;
}

/**
 * The anchor-role change {@link isHistoryRewrite} cannot see. A fast-forward merge, a branch checkout, a
 * `reset`, or a checkout of a branch that was previously HIDDEN all move HEAD onto history the prior
 * layout did not place on the trunk. No commit is rewritten (so it isn't a rewrite), but the trunk
 * RE-ROOTS: sticky columns keep the now-current branch on its old side lane, leaving the base lane with a
 * gap. The area-based renormalize backstop cannot catch it — the misroute is local and equal-width — and
 * neither can any lane-shape test, because a branch beside an empty lane is also what an ordinary
 * side-lane gap looks like. So the decision has to be made from REFS, here. Callers drop `stableFrom`
 * (lay out cold, == reopening the graph) when this returns true.
 *
 * The test: walk the new HEAD's first-parent chain back to the first commit the PRIOR layout already
 * contained — the "anchor" the new HEAD hangs off — and re-root iff that anchor was NOT on the prior
 * trunk. One rule, and it separates every case exactly:
 *
 *  - ordinary commit / pull fast-forward → the anchor is the old HEAD (or its trunk), so sticky is kept
 *    and lane stability survives the most common updates;
 *  - fast-forward merge / checkout / reset onto a loaded side-lane commit → the anchor is that commit
 *    itself, off-trunk → drop;
 *  - checkout of a HIDDEN branch → its commits are new, but the chain lands on the visible ancestor it
 *    forks from; if that sits off-trunk the revealed chain would INHERIT its stale side lane → drop;
 *  - checkout to a commit on the prior trunk → anchor is on-trunk → keep (a same-lane move).
 *
 * Pure over caller-supplied lookups, so the walk lives here (tested) while the caller keeps the data:
 * `firstParentOf(sha)` = that commit's first parent among the FRESH rows; `wasLaidOut(sha)` = the prior
 * layout contained it; `isOnPriorTrunk(sha)` = it sat on the prior HEAD's first-parent chain. The lookups
 * are consulted in cheapest-first order and only as far as an answer needs, so callers can make the
 * expensive ones (`isOnPriorTrunk` in particular) lazy.
 */
export function isTrunkReroot(
	priorHeadSha: string | undefined,
	newHeadSha: string | undefined,
	lookups: {
		firstParentOf: (sha: string) => string | undefined;
		wasLaidOut: (sha: string) => boolean;
		isOnPriorTrunk: (sha: string) => boolean;
	},
): boolean {
	if (newHeadSha == null || newHeadSha === priorHeadSha) return false;

	// Walk to the anchor: the nearest first-parent ancestor (inclusive) the prior layout already had.
	// `seen` guards only against malformed input — a commit DAG cannot cycle.
	let anchor: string | undefined = newHeadSha;
	const seen = new Set<string>();
	while (anchor != null && !lookups.wasLaidOut(anchor)) {
		seen.add(anchor);
		anchor = lookups.firstParentOf(anchor);
		if (anchor != null && seen.has(anchor)) return false;
	}

	// No recognizable ancestor means the visible history is wholly different — `isHistoryRewrite` owns
	// that case; treat it as not-a-re-root rather than guessing.
	if (anchor == null) return false;
	// The prior HEAD tips its own trunk, so an anchor that IS the prior HEAD can never be a re-root. This
	// is the ordinary-commit and pull-fast-forward path: answer here, without ever asking for (and having
	// the caller build) the prior trunk chain.
	if (anchor === priorHeadSha) return false;

	return !lookups.isOnPriorTrunk(anchor);
}
