import type {
	GitGraph,
	GitGraphRow,
	GitGraphRowStats,
	GraphReachabilityTable,
	IncrementalGraphFallbackReason,
} from './graph.js';

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
 * byte-identical. R7b (refresh-result-driven channel marking) and R7c (restart persistence) extend this
 * without breaking — {@link refresh} returns a result object, never a bare `GitGraph`.
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

	/**
	 * Snapshot the canonical window for restart persistence, or `undefined` when there's nothing worth
	 * persisting — an empty window, or a provider without an incremental restore path (e.g. GitHub, which
	 * stamps no ref tips for the restore's tip-diff gate). The host writes this into the repo's own git dir
	 * (`<commonGitDir>/gitlens/graph/` — a repo-derived cache, like git's commit-graph file) on an idle
	 * debounce / dispose; a later {@link GitGraphSubProvider.openGraphSession} `restore` reconstructs +
	 * refreshes it. Never trusted over git — restore always re-refreshes (see {@link GitGraphSessionSnapshot}).
	 */
	serialize(): GitGraphSessionSnapshot | undefined;

	dispose(): void;
}

/**
 * Schema version for {@link GitGraphSessionSnapshot}. Bump on ANY shape change (field add/remove/rename or a
 * semantics change): a restore whose snapshot version doesn't match this EXACTLY is discarded (a normal
 * initial walk), so an old-shaped cache written by a prior extension version can never be misread.
 */
export const graphSessionSnapshotVersion = 3;

/**
 * Restart-persistence snapshot of a {@link GitGraphSession}'s canonical window — everything a restore needs
 * to reconstruct the session's prior generation as an R6 incremental SEED, so a cold open on an unchanged
 * repo is ≈ deserialize + one enumeration instead of a full walk.
 *
 * NEVER trusted over git: on restore the session reconstructs this as its window/tips/builders WITHOUT any
 * git, then IMMEDIATELY {@link GitGraphSession.refresh | refreshes} — the same enumeration + tip-diff + FF +
 * stash gates reconcile a stale snapshot (fast when unchanged, a full walk on any structural change), and any
 * parse/validation failure discards it entirely for a normal initial walk.
 *
 * Rows are persisted as-is: they're already the JSON-safe wire shapes (strings/numbers/plain objects — the
 * graph's Maps live at the graph level, not on rows, and the transient per-row `reachability` is stripped
 * before a row is emitted). Maps are persisted as entry arrays.
 */
export interface GitGraphSessionSnapshot {
	/** Must equal {@link graphSessionSnapshotVersion}; any mismatch discards the snapshot. */
	readonly v: number;
	readonly repoPath: string;
	/** Walk shape the window was produced under (`${ordering}|${onlyFollowFirstParent}`). A restore is
	 *  discarded when this disagrees with the current config's shape — the cached rows can't be reused. */
	readonly buildShape: string;
	readonly ordering: 'date' | 'author-date' | 'topo';
	readonly onlyFollowFirstParent: boolean;
	/** The persisted window rows, in walk order — a TOP slice capped at a bounded row count (see the host
	 *  store); a longer window persists its top slice with {@link hasMore} forced true so the bottom re-pages. */
	readonly rows: GitGraphRow[];
	/** Ref tips as of the persisted walk: `[canonical refname, peeled tip sha]` entries — the map the restore
	 *  refresh diffs against current git to find the structural changes that force a full fallback. */
	readonly refTips: [string, string][];
	/** {@link GitGraph.decorationFingerprint} as of the persisted walk — the restore refresh diffs it against
	 *  current git so a metadata-only change while closed (upstream/default/worktree/remote/user) still forces
	 *  the full fallback that rebuilds row decorations. Absent ⇒ never matches ⇒ safe full fallback. */
	readonly decorationFingerprint?: string;
	/** Shared reachability table for the window (the primary reachability representation — rows carry only a
	 *  `contexts.reachabilityIndex` into its `sets`). The restore refresh CONTINUES it (stable indices). */
	readonly reachability?: GraphReachabilityTable;
	/** Per-sha immutable stats `[sha, stats]` entries for the persisted rows (present only when stats were
	 *  included in the walk). */
	readonly rowsStats?: [string, GitGraphRowStats][];
	/** Downstreams `[upstream name, tracking branch names]` entries (for the refresh's change diffing). */
	readonly downstreams: [string, string[]][];
	/** Whether the persisted window had more rows below it — genuinely paged OR truncated by the cap. */
	readonly hasMore: boolean;
	/** Whether the persisted walk included per-row stats. */
	readonly includesStats: boolean;
	/** Whether the repo was a shallow clone when the window was walked. The restore refresh diffs this
	 *  against current git — an un-shallow (or re-shallow) while closed forces a full fallback. */
	readonly shallow: boolean;
}

/** Why a restore discarded its snapshot (reported via {@link GraphSessionRestoreResult.reason}). */
export type GraphSessionRestoreDiscardReason =
	| 'schema'
	| 'repo-path'
	| 'shape'
	| 'empty'
	| 'tips'
	| 'rows'
	| 'reachability'
	| 'downstreams'
	| 'rowsStats'
	// A throw past structural validation (e.g. the restore refresh's enumerate chokes on a garbage rev).
	| 'corrupt';

/**
 * Outcome of a restore attempt, reported via the {@link GitGraphSubProvider.openGraphSession} `onRestore`
 * callback so the host can emit its single, assertable INFO line. `restored` is true only when the snapshot
 * validated and seeded the (always-run) refresh — `refresh` then carries that refresh's path so the host can
 * distinguish `→ refresh fast (+M)` from `→ refresh full (<reason>)`.
 */
export interface GraphSessionRestoreResult {
	readonly restored: boolean;
	/** Present when `!restored`: why the snapshot was discarded; the host logs `miss (<reason>)`. */
	readonly reason?: GraphSessionRestoreDiscardReason;
	/** Present when `restored`: how many window rows the snapshot carried. */
	readonly rows?: number;
	/** Present when `restored`: the post-restore refresh outcome (a restore ALWAYS refreshes to current truth). */
	readonly refresh?: GitGraphSessionRefreshResult;
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
