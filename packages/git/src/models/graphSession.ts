import type { GitGraph, GitGraphRow, IncrementalGraphFallbackReason } from './graph.js';

/**
 * A provider-owned, stateful graph window for a single repo. It is the canonical accumulated window and
 * the single builder of the incremental rebuild seed — the host no longer mirrors loaded rows, stamps
 * ref tips, or hand-assembles the {@link GraphIncrementalSeed}; the session owns its own walk shape and
 * cannot be handed a lying seed.
 *
 * R7a is a behavior-neutral ownership move: {@link refresh} is a facade over the provider's existing
 * `getGraph` incremental machinery (it internally builds the seed from the accumulated window, tips, and
 * prior artifacts, with the same shape gating), {@link more} delegates to the prior result's `more()`,
 * and {@link current} mirrors today's `GitGraph` result shape so the publisher/wire semantics stay
 * byte-identical. R7b (refresh-result-driven channel marking) extends this without breaking —
 * {@link refresh} returns a result object, never a bare `GitGraph`.
 *
 * CONCURRENCY — the session is SINGLE-WRITER: {@link refresh}, {@link rebind} and {@link more} serialize
 * in call order, so `repoPath` and every row in `window` always describe the last completed operation,
 * never a torn mix of two. A page queued when a refresh/rebind REPLACES the window it targets is refused
 * (`more` answers `'superseded'`) rather than spliced onto a cursor that no longer fits — see {@link more}.
 *
 * READS are not serialized: a caller that must not observe a half-rebuilt window gates its own read.
 */
export interface GitGraphSession {
	/** The CURRENT bound path — the repo the session was opened for, or the worktree it was last
	 *  {@link rebind}-ed onto. */
	readonly repoPath: string;

	/** Canonical accumulated window (the FULL loaded rows, never page-scoped after pagination). */
	readonly window: readonly GitGraphRow[];

	/**
	 * True while {@link window}/{@link current} are known CORRUPT from a walk that failed part-way through
	 * mutating them in place. Clears on the next (forced) rebuild. A caller that would SERVE these rows
	 * must check this first — reads bypass the write queue, so nothing else enforces it.
	 */
	readonly tainted: boolean;

	/**
	 * Last-operation view mirroring today's `GitGraph` result shape: page-scoped `rows` after a
	 * {@link more}, the full window after a {@link refresh}. Keeps the publisher's `getRows`/`getPaging`
	 * and every graph-level read (`branches`, `remotes`, `stashes`, `ids`, `avatars`, `rowsStats`, …)
	 * exactly as they read `_graph` today.
	 */
	readonly current: GitGraph;

	/**
	 * Re-walk the repo, accumulating the fresh full window. Internally seeds the incremental head-walk
	 * fast path from the prior window/tips/artifacts (same shape gating as the host did) and falls back
	 * to a full walk on any structural change; the result surfaces which path ran so a later stage can
	 * mark channels precisely.
	 */
	refresh(options?: GitGraphSessionRefreshOptions, cancellation?: AbortSignal): Promise<GitGraphSessionRefreshResult>;

	/**
	 * Page more rows into the window (accumulates; `current` becomes the page view). See
	 * {@link GitGraphSessionMoreResult} — a caller MUST distinguish `'superseded'` (retry) from `'none'`
	 * (don't).
	 */
	more(limit?: number, targetId?: string, cancellation?: AbortSignal): Promise<GitGraphSessionMoreResult>;

	/**
	 * Re-perspective the session onto another worktree of the SAME repo family without discarding
	 * the accumulated window. Rides the incremental fast path: unchanged tips, HEAD endpoints
	 * refetched, flags/reachability replayed, ref ids re-stamped to the new path. Falls back to a
	 * full walk only when a genuine structural/metadata change happened concurrently.
	 */
	rebind(repoPath: string, cancellation?: AbortSignal): Promise<GitGraphSessionRefreshResult>;

	dispose(): void;
}

export interface GitGraphSessionRefreshOptions {
	/** Rebuild anchor / find target — the loaded window's bottom sha (pins the walk's bottom boundary),
	 *  or a selection/centering hint. Mirrors the `rev` the host passed to `getGraph` today. */
	rev?: string;
	limit?: number;
	include?: { stats?: boolean };
	/**
	 * Force a FULL walk (skip the incremental seed) so every row's decorations — including the
	 * host-serialized webview-item contexts reused rows otherwise keep — are rebuilt from fresh inputs.
	 * For host-known invalidations the provider can't observe (pinned-ref changes, integration
	 * connections); rare events, so the full-walk cost is acceptable.
	 */
	rebuild?: boolean;
}

/**
 * Outcome of a {@link GitGraphSession.refresh}. `path` is `'fast'` only when the incremental head-walk
 * fast path ran; a seeded fallback and an unseeded full walk both report `'full'` — a seeded fallback
 * additionally carries `reason` (an unseeded full walk carries none), so a consumer can distinguish the
 * two exactly as the host's `[graph] incremental walk` log did (log on `'fast'` or a `reason`, silent
 * otherwise).
 */
export interface GitGraphSessionRefreshResult {
	readonly path: 'fast' | 'full';
	/** Present only on a SEEDED refresh that fell back to the full walk — the gate/boundary that forced it. */
	readonly reason?: IncrementalGraphFallbackReason;
	/** Fast path only: how many NEW commit rows the incremental enumeration added at the head. */
	readonly added?: number;
	/**
	 * Which rows-plane channels this refresh actually changed, so the host marks the publisher precisely
	 * instead of dirtying all six on every refresh. Filled by BOTH paths: the full path reports every
	 * channel changed (a fresh walk replaces all); the fast path derives each honestly from its own work.
	 * Correctness rule: a false negative is data loss, so a channel is reported `false` only when it
	 * PROVABLY didn't change — never merely when uncertain. Excludes `refsMetadata`, which the session
	 * doesn't produce (the host marks it via its own dedicated enrichment path).
	 */
	readonly changed: GitGraphSessionChangedChannels;
}

/** Per-channel change flags a {@link GitGraphSession.refresh} reports (see {@link GitGraphSessionRefreshResult.changed}). */
export interface GitGraphSessionChangedChannels {
	/** The loaded rows window — always `true` on a refresh (a head-walk reshapes it; the publisher's ledger
	 *  diff derives the precise splice, including reused-row flag/reachability-index changes). */
	readonly rows: boolean;
	/** The shared reachability table grew (new dictionary/set entries appended) or started a new generation. */
	readonly reachability: boolean;
	/** New commit shas were introduced whose stats will be (re)queried. */
	readonly rowsStats: boolean;
	/** Full fallbacks that rewrite parents (unshallow / replace-ref change) recompute stats whose
	 *  values may differ for already-shipped shas — the host must resend, not just append. */
	readonly rowsStatsRecomputed?: boolean;
	/** New avatar emails appeared in the map (value replacements ride the host's dedicated avatar path). */
	readonly avatars: boolean;
	/** The downstreams map (upstream name → tracking branch names) changed. */
	readonly downstreams: boolean;
}

/**
 * The outcome of a {@link GitGraphSession.more}. Three states, not a boolean, because the caller's correct
 * response to two of them differs: a page that was REFUSED must be retried, while a page that found
 * nothing must not (retrying it spins).
 */
export type GitGraphSessionMoreResult =
	/** Rows were paged in — `current` is the page view and `window` grew. */
	| 'added'
	/** Nothing to add: history is exhausted, or the walk came back empty. Terminal for this request. */
	| 'none'
	/**
	 * REFUSED, having walked nothing and changed nothing: a {@link GitGraphSession.refresh} or
	 * {@link GitGraphSession.rebind} replaced the window this page targeted while it was queued. The
	 * caller must RE-REQUEST against the current window (re-deriving cursor/limit) rather than treat this
	 * as terminal — the rows are still there to page.
	 */
	| 'superseded';

/**
 * The concurrency contract every {@link GitGraphSession} implementation shares — compose it
 * (`private readonly writes = new GraphSessionWriteQueue()`) rather than reimplementing it, so the two
 * implementations cannot drift apart.
 *
 * {@link run} makes every mutating op single-writer: no interleaving, no torn window. {@link generation}
 * (via {@link runPage}) separately answers whether a QUEUED page still targets the window that exists,
 * since queueing alone can't. READS are not covered — `current`/`window` are plain getters, readable at
 * any time including mid-walk; a caller that must not observe a half-rebuilt window gates its own read.
 *
 * DEADLOCK-FREEDOM requires the function handed to {@link run} to await only its own walk, never a
 * promise a caller might be waiting on — sequencing waits belong strictly BEFORE the op enters the queue.
 */
export class GraphSessionWriteQueue {
	/** Tail of the queue. Starts settled so the first op runs immediately. */
	private _tail: Promise<unknown> = Promise.resolve();
	private _generation = 0;
	private _tainted = false;

	/**
	 * The window is known-CORRUPT and must not be served until a rebuild repairs it — see {@link taint}.
	 * Consulted by readers, which is the point: the queue keeps writers apart, but a reader of `current`
	 * never enters it, so the only way a corrupt window can be kept off screen is for the reader to ask.
	 */
	get tainted(): boolean {
		return this._tainted;
	}

	/** Monotonic id of the CURRENT window. See {@link invalidate}. */
	get generation(): number {
		return this._generation;
	}

	/**
	 * Call when the window has been REPLACED (a full/incremental rebuild), never when merely extended —
	 * appending a page leaves every held cursor valid. Also the REPAIR for a tainted window, so it clears
	 * {@link tainted}.
	 */
	invalidate(): void {
		this._generation++;
		this._tainted = false;
	}

	/**
	 * Call when a walk failed PART-WAY THROUGH mutating the window in place, leaving some rows re-stamped
	 * and some not. Advances the generation, same as {@link invalidate}, so a queued page is refused rather
	 * than appended to a corrupt window — and additionally raises {@link tainted}, since refusing pages
	 * doesn't stop a reader from serving the window directly.
	 */
	taint(): void {
		this._generation++;
		this._tainted = true;
	}

	/** Runs `op` after every op queued before it has settled. */
	run<T>(op: () => Promise<T>): Promise<T> {
		// `.catch` BEFORE `.then` so a rejected predecessor can't wedge the queue — without it every later
		// op would inherit the rejection and never run its body at all.
		const next = this._tail.catch(() => undefined).then(op);
		// The caller's promise IS the tail, so a rejection the caller handles is never ALSO an unhandled
		// rejection on a derived promise nobody holds a reference to.
		this._tail = next;
		return next;
	}

	/**
	 * Runs a PAGE. Captures {@link generation} synchronously HERE, before queueing, and refuses the page
	 * without running `op` if the window has been replaced by the time it reaches the front — the
	 * `'superseded'` half of {@link GitGraphSessionMoreResult}.
	 */
	runPage(op: () => Promise<GitGraphSessionMoreResult>): Promise<GitGraphSessionMoreResult> {
		const generation = this._generation;
		return this.run(() => {
			// Two ways a page can go stale by now, both answering `'superseded'`: the window it was cut from
			// was REPLACED (generation moved), or it's TAINTED — generation alone can't catch the latter, since
			// a page requested AFTER the corruption still sees a stable generation.
			if (this._tainted || this._generation !== generation) return Promise.resolve('superseded' as const);

			return op();
		});
	}
}
