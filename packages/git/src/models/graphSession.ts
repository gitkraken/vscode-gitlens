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
 */
export interface GitGraphSession {
	readonly repoPath: string;

	/** Canonical accumulated window (the FULL loaded rows, never page-scoped after pagination). */
	readonly window: readonly GitGraphRow[];

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
	 * Page more rows into the window (accumulates; `current` becomes the page view). Returns `false` when
	 * there was nothing to add or a concurrent {@link refresh} superseded the page.
	 */
	more(limit?: number, targetId?: string, cancellation?: AbortSignal): Promise<boolean>;

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
