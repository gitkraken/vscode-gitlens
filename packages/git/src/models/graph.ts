import type { GitCommitReachability } from '../providers/commits.js';
import type { GitBranch } from './branch.js';
import type { GitStashCommit } from './commit.js';
import type { GitRemote } from './remote.js';
import type { GkProviderId } from './repositoryIdentities.js';
import type { GitWorktree } from './worktree.js';

export type GitGraphRowType =
	| 'commit-node'
	| 'merge-node'
	| 'stash-node'
	| 'work-dir-changes'
	| 'merge-conflict-node'
	| 'unsupported-rebase-warning-node';

export interface GitGraphRowHead {
	id?: string;
	name: string;
	isCurrentHead: boolean;
	context?: string | object;
	upstream?: { name: string; id: string };
	/** Set when this branch is checked out in a (non-default) worktree. Grouped so producers can't
	 *  half-populate id-without-path or vice versa. GitLens consumers should read this field. */
	worktree?: { id: string; path: string };
	/** Upstream-component-compatibility mirror of `worktree?.id`. The bundled
	 *  `@gitkraken/gitkraken-components` library still reads `worktreeId` to switch between
	 *  WORKTREE and HEAD ref-badge styling — keeping it populated preserves the visual cue.
	 *  Producers MUST set this whenever they set `worktree`; do not read it from GitLens code,
	 *  read `worktree.id` instead. */
	worktreeId?: string;
	/** True when this head is the repository's default branch. */
	isDefault?: boolean;
}

export interface GitGraphRowRemoteHead {
	id?: string;
	name: string;
	url?: string;
	owner: string;
	avatarUrl?: string;
	context?: string | object;
	current?: boolean;
	/** True when this remote ref IS the repository's default branch and no local branch tracks it (no
	 *  local checkout) — so the default-branch tier still applies for remote-only defaults. */
	isDefault?: boolean;
	hostingServiceType?: GkProviderId;
}

export interface GitGraphRowTag {
	id?: string;
	name: string;
	annotated: boolean;
	context?: string | object;
}

/**
 * Compact, host-computed flags for a commit/stash row, shipped instead of the bulky serialized
 * `contexts.row`/`contexts.avatar` blobs (which duplicated sha/message/repoPath already on the row).
 * The webview reconstructs the full webview-item contexts from these flags + row fields + repoPath.
 * Bit 0: reachable-from-HEAD (`+current`); Bit 1: unique-to-one-local-branch (`+unique`);
 * Bit 2: has-children — set ONLY on undo-eligible tip rows (active HEAD + worktree HEADs) that have a
 * child, to gate Undo Commit to leaf tips (undoing a commit other work is stacked on is unsafe). It is
 * NOT a general has-children signal: non-tip rows never carry it (the host only computes it for tips);
 * Bit 3: unpushed/ahead-of-upstream (`+unpublished`).
 * Bit 4: history-rewriteable (`+rewriteable`) — on the first-parent chain from HEAD up to (excluding)
 * the first merge commit, so a plain (non-`--rebase-merges`) interactive rebase can safely rewrite it;
 * gates squash/drop/reword/modify. Strictly narrower than `+current` (reachable-from-HEAD includes a
 * merge's other-parent ancestry, which is NOT safely rewriteable).
 * (`+HEAD` derives from `row.heads[].isCurrentHead`; contributor `+current` from `row.isCurrentUser`.)
 */
export const enum GitGraphRowContextFlags {
	None = 0,
	ReachableFromHead = 1 << 0,
	UniqueToBranch = 1 << 1,
	HasChildren = 1 << 2,
	Unpublished = 1 << 3,
	RewriteableFromHead = 1 << 4,
}

/**
 * Context data attached to graph row regions for command/menu handling.
 * Structurally compatible with @gitkraken/gitkraken-components RowContexts.
 */
export interface GitGraphRowContexts {
	/** Compact replacement for the serialized commit `row`/`avatar` contexts; see {@link GitGraphRowContextFlags}. */
	flags?: GitGraphRowContextFlags;
	/**
	 * Index into the per-graph `GraphReachabilityTable.sets` for this row's reachable-refs set,
	 * shipped instead of the per-row `reachability` object (which dominated the graph payload). The
	 * webview rebuilds `row.reachability` from the shared table. Absent ⇒ no reachability for this row.
	 */
	reachabilityIndex?: number;
	row?: string | object;
	ref?: string | object;
	refGroups?: Record<string, string | object>;
	graph?: string | object;
	avatar?: string | object;
	message?: string | object;
	author?: string | object;
	date?: string | object;
	sha?: string | object;
	stats?: string | object;
}

export interface GitGraphRowStats {
	files: number;
	additions: number;
	deletions: number;
}

/**
 * Wire encoding for per-row reachability, shipped once per graph payload instead of inline on every
 * row. Git reachability is monotone (adjacent commits share ref-sets), so the rows collapse to a
 * relatively small number of distinct sets over the repo's ref universe — `dictionary` (the shared
 * ref list) + `sets` (distinct membership bitmaps, base64; bit i ⇒ `dictionary[i]` reachable) + a
 * per-row index (`GitGraphRowContexts.reachabilityIndex`) reconstructs every row's `reachability`
 * client-side for a fraction of the bytes the inline objects cost. `current` is a per-ref property
 * (the checked-out HEAD branch) and lives in the dictionary entry.
 *
 * The table is append-only within a graph generation, so the host ships only the entries appended
 * since its last push (a delta) on same-generation pagination and the full table on a new generation;
 * `id` lets the webview tell the two apart (same `id` ⇒ append the delta, new `id` ⇒ replace + reset
 * its decode cache). A fresh `getGraph` walk mints a new `id`; `more()` keeps the same one.
 */
export interface GraphReachabilityTable {
	/** Generation id — stable across `more()` pagination, new per fresh graph walk. */
	readonly id: number;
	readonly dictionary: GitCommitReachability['refs'];
	/** Distinct ref-membership bitmaps, base64-encoded `Uint8Array` of `ceil(dictionary.length/8)` bytes. */
	readonly sets: string[];
}

/** Library-owned graph row type. Structurally compatible with @gitkraken/gitkraken-components GraphRow. */
export interface GitGraphRow {
	sha: string;
	parents: string[];
	author: string;
	email: string;
	date: number;
	commitDate?: number;
	message: string;
	type: GitGraphRowType;
	heads?: GitGraphRowHead[];
	remotes?: GitGraphRowRemoteHead[];
	tags?: GitGraphRowTag[];
	contexts?: GitGraphRowContexts;
	stats?: GitGraphRowStats;
	/**
	 * Transient, set only for the duration of {@link GraphRowProcessor.processRow} (the row processor's
	 * `+unique` decision reads it). The provider strips it before pushing the row and records the
	 * reachable-ref set into the shared {@link GitGraph.reachability} table instead (see
	 * {@link GitGraphRowContexts.reachabilityIndex}), so emitted rows do NOT retain the per-row arrays.
	 */
	reachability?: GitCommitReachability;
	isCurrentUser?: boolean;
}

export interface GitGraph {
	readonly repoPath: string;
	/** A map of all avatar urls */
	readonly avatars: Map<string, string>;
	/** A set of all "seen" commit ids */
	readonly ids: Set<string>;
	readonly includes: { stats?: boolean } | undefined;
	readonly branches: ReadonlyMap<string, GitBranch>;
	readonly remotes: ReadonlyMap<string, GitRemote>;
	readonly downstreams: ReadonlyMap<string, string[]>;
	readonly stashes: ReadonlyMap<string, GitStashCommit> | undefined;
	readonly worktrees: ReadonlyArray<GitWorktree> | undefined;
	readonly worktreesByBranch: ReadonlyMap<string, GitWorktree> | undefined;

	/** SHAs reachable from HEAD (for enrichment: marking commits on the current branch) */
	readonly reachableFromHEAD?: ReadonlySet<string>;

	/**
	 * Ref tips as of this walk: canonical refname (`refs/heads/…`, `refs/remotes/…`, `refs/tags/…`) →
	 * PEELED tip sha (annotated tags map to the commit their badge sits on). Captured so the host can seed
	 * the NEXT rebuild's {@link GraphIncrementalSeed.tips} — the map the R6b fast path diffs against to find
	 * the structural changes that force a full fallback. The CLI provider populates it on both paths (full
	 * walk + fast path); the GitHub provider leaves it undefined.
	 */
	readonly refTips?: ReadonlyMap<string, string>;

	/**
	 * Fingerprint of every SIDE INPUT row construction embeds into row decorations as of this walk —
	 * default branch, per-branch upstreams, HEAD's upstream, remote urls/providers, worktree assignments,
	 * and the current user. These can all change WITHOUT moving any ref tip (`git remote set-head`,
	 * `branch --set-upstream-to`, `worktree add`, remote/user config edits), and the R6b fast path reuses
	 * prior rows wholesale (only flags/reachability are re-derived) — so it must compare this against the
	 * seed's and fall back to a full walk on ANY change. The CLI provider populates it on both paths; the
	 * GitHub provider leaves it undefined.
	 */
	readonly decorationFingerprint?: string;

	/**
	 * Whether the repo was a SHALLOW clone (a `$GIT_DIR/shallow` file was present) as of this walk. Captured
	 * so the host can seed the NEXT rebuild's {@link GraphIncrementalSeed.shallow}: an un-shallow (or
	 * re-shallow) while the graph is closed passes every ref-tip gate — the branch tips don't move — yet
	 * changes what history exists BELOW the loaded window, so a stale-false `hasMore` would hide the newly
	 * deepened commits. The R6b fast path falls back on any change. The CLI provider populates it on both
	 * paths (full walk + fast path); the GitHub provider leaves it undefined.
	 */
	readonly shallow?: boolean;

	/**
	 * SHAs on the first-parent chain from HEAD up to (excluding) the first merge commit — i.e. the
	 * commits a plain interactive rebase can safely rewrite. Empty when HEAD itself is a merge. Used by
	 * the graph's history-rewriting commands (squash/drop/reword/modify) to validate selections.
	 */
	readonly rewriteableFromHEAD?: ReadonlySet<string>;

	/**
	 * Shared, append-only reachability table for the loaded rows (the primary representation — rows
	 * carry only a {@link GitGraphRowContexts.reachabilityIndex} into it, not per-row ref arrays).
	 * Grows monotonically across {@link more} pagination within a graph session: indices already
	 * assigned never change, so consumers can decode any row on demand and cache by index. Absent ⇒
	 * no row in the graph has reachability. See {@link GraphReachabilityTable}.
	 */
	readonly reachability?: GraphReachabilityTable;

	/** The rows for the set of commits requested */
	readonly rows: GitGraphRow[];
	readonly id?: string;

	readonly rowsStats?: GitGraphRowsStats;
	readonly rowsStatsDeferred?: { isLoaded: () => boolean; promise: Promise<void> };

	readonly paging?: {
		readonly limit: number | undefined;
		readonly startingCursor: string | undefined;
		readonly hasMore: boolean;
	};

	/**
	 * Loads more commits for the graph.
	 *
	 * @param limit - The number of commits to load (page size)
	 * @param id - Optional SHA to find
	 * @param cancellation - Cancellation token
	 *
	 * **Behavior based on parameters:**
	 *
	 * - **`id` provided + `limit > 0`**: Find the commit with the given SHA, then ensure at least `limit` commits are loaded.
	 *   - If SHA is found early (e.g., at position 100), continues loading to reach `limit` total commits.
	 *   - If SHA is found late (e.g., at position 2000 when limit is 1000), loads all commits up to and including the SHA.
	 *   - This ensures the target commit is included AND provides a full page of context.
	 *
	 * - **`id` provided + `limit === 0`**: Find the commit with the given SHA and stop immediately.
	 *   - Loads only as many commits as needed to reach the target SHA.
	 *   - Used when you want to find a specific commit without loading extra commits.
	 *
	 * - **No `id` + `limit > 0`**: Load exactly `limit` commits (normal pagination).
	 *   - Standard page-based loading without a specific target.
	 *
	 * - **No `id` + `limit === 0`**: Load all remaining commits.
	 *   - Loads everything from the current position to the end of history.
	 *   - Use with caution as this can load a large number of commits.
	 *
	 * @example
	 * // Load next page of 1000 commits
	 * await graph.more(1000);
	 *
	 * @example
	 * // Find a specific commit and ensure a full page is loaded
	 * await graph.more(1000, 'abc123');
	 *
	 * @example
	 * // Find a specific commit and stop (minimal loading)
	 * await graph.more(0, 'abc123');
	 */
	more?(limit: number, id?: string, cancellation?: AbortSignal): Promise<GitGraph | undefined>;
}

export type GitGraphRowsStats = Map<string, GitGraphRowStats>;

/**
 * Seed for the R6b incremental head-walk fast path. Carries the prior generation's walk artifacts so a
 * repo-change rebuild can walk ONLY the changed head region, stitch the cached tail, and re-derive
 * flags/reachability in memory — instead of re-walking every loaded row.
 *
 * R6a status: the Node provider ACCEPTS this option but IGNORES it, falling through to the full ordered
 * walk (so a seeded rebuild is byte-equivalent to an unseeded one). It is threaded now purely so the
 * equivalence harness can pin the shape and R6b can light up the fast path without an interface change.
 * The GitHub provider ignores it structurally (it never lists the option).
 */
export interface GraphIncrementalSeed {
	/**
	 * Prior generation's emitted rows, in walk order. R6b stitches the unchanged tail from these once the
	 * streamed head region CONVERGES with them (K consecutive shas aligned at a stable offset), and reads
	 * their parent lists to re-derive reachability/flags in memory (no git) over the stitched window.
	 */
	readonly rows: readonly GitGraphRow[];
	/**
	 * Ref tips as of the prior walk: canonical refname (e.g. `refs/heads/main`, `refs/remotes/origin/main`,
	 * `refs/tags/v1`) → tip sha. R6b enumerates the new commits via `git log --all --not <these shas>`
	 * (cheap, exact) and diffs this map against the current tips to detect the structural changes that force
	 * a full fallback: any ref DELETION (key gone) or a NON-fast-forward move (old tip not an ancestor of the
	 * new tip).
	 */
	readonly tips: ReadonlyMap<string, string>;
	/**
	 * Ordering the prior rows were walked in. The convergence + date-boundary reasoning R6b relies on is only
	 * sound for `date` order in v1; a seed whose ordering is `author-date`/`topo`, or that disagrees with the
	 * current walk's ordering, is discarded (full fallback).
	 */
	readonly ordering: 'date' | 'author-date' | 'topo';
	/**
	 * Prior generation's reachability table, to CONTINUE (same role as the sub-provider's `reachabilitySeed`)
	 * so rows retained across the rebuild keep stable {@link GitGraphRowContexts.reachabilityIndex} values and
	 * only appended entries ship. R6b decides whether the stitched window extends this builder or needs a
	 * fresh generation; see `createReachabilityTableBuilder`.
	 */
	readonly reachability?: GraphReachabilityTable;
	/**
	 * Prior generation's per-sha stats (immutable per sha), so the deferred stats query recomputes only the
	 * new shas — same role as `rowsStatsSeed`.
	 */
	readonly rowsStats?: GitGraphRowsStats;
	/**
	 * Whether the prior generation had more rows below its loaded window (`paging.hasMore`). The fast path
	 * can only reconstruct rows the seed carries; when the seed was a partial (paged) load and no new commit
	 * pushes the window past its limit, `hasMore` must still be reported so the caller keeps paging. Absent ⇒
	 * treated as `false` (the seed loaded the full history).
	 */
	readonly hasMore?: boolean;
	/**
	 * The `graph.onlyFollowFirstParent` setting the prior rows were walked under. When first-parent is on the
	 * emitted rows carry sliced (first-parent-only) parents, which the in-memory re-derivation can't expand
	 * back to the full parent set the walk propagates reachability through — so a seed built under (or a
	 * current config of) first-parent forces a full fallback. Absent ⇒ treated as `false`.
	 */
	readonly onlyFollowFirstParent?: boolean;
	/**
	 * Whether the repo was a SHALLOW clone when the prior rows were walked. R6b falls back to a full walk on
	 * ANY change vs. the current state (shallow→unshallowed, unshallowed→shallow): an un-shallow deepens
	 * history below the loaded window while every branch tip stays put, so the cached tail / stale-false
	 * `hasMore` would hide the newly deepened commits. Absent ⇒ treated as `false` (not shallow).
	 */
	readonly shallow?: boolean;
	/**
	 * {@link GitGraph.decorationFingerprint} of the prior walk. R6b falls back to a full walk on ANY change:
	 * reused rows keep their embedded decorations (upstream/worktree/default/remote/user metadata), so a
	 * metadata-only change — one that moves no ref tip — would otherwise ship stale pills indefinitely.
	 * Absent (e.g. an old persisted snapshot) ⇒ never matches ⇒ safe full fallback.
	 */
	readonly decorationFingerprint?: string;
}

/**
 * Which path a seeded {@link GitGraphSubProvider.getGraph} call took: the R6b incremental head-walk fast
 * path, or a full ordered walk (with the gate/boundary `reason` that forced it). Reported via the
 * `onIncrementalResult` option so the host can log it and the equivalence harness can assert it. Purely
 * observational — it never changes the returned graph.
 */
export interface IncrementalGraphOutcome {
	readonly path: 'fast' | 'fallback';
	readonly reason?: IncrementalGraphFallbackReason;
	/** Fast path only: how many NEW commit rows the incremental enumeration added at the head. */
	readonly added?: number;
}

export type IncrementalGraphFallbackReason =
	| 'no-row-processor'
	| 'ordering-not-date'
	| 'rev-outside-seed'
	| 'first-parent'
	| 'limit-exceeds-seed'
	| 'ref-deleted'
	| 'ref-non-fast-forward'
	| 'replace-refs-changed'
	| 'shallow-changed'
	| 'stash-changed'
	| 'stash-window-conflict'
	| 'date-boundary'
	// A decoration side input changed without moving any ref tip (default branch, an upstream, a worktree
	// assignment, a remote's url/provider, the current user) — reused rows would keep stale embedded
	// decorations, so the walk must rebuild them. See `GitGraph.decorationFingerprint`.
	| 'metadata-changed'
	// The fast path threw (spawn/arg limits on huge ref sets, queue overflow, transient git errors) —
	// never an eligibility gate. The fast path must never fail where the full walk it accelerates
	// would succeed, so any unexpected error degrades to the full walk (cancellation still propagates).
	| 'error';

/**
 * Processes a single graph row — mutates the row in place.
 *
 * Sets `row.contexts`, `row.message` (e.g., emojified), `tag.context`,
 * `head.context`, `remoteHead.context`, `remoteHead.avatarUrl`.
 * Also populates `context.avatars` with email → URL mappings.
 *
 * Called inline during graph row iteration in the library's row-building
 * loop, once per row. Because it runs inside the loop, `more()` pagination
 * automatically gets processing for free — no wrapping needed.
 */
export interface GraphRowProcessor {
	processRow(row: GitGraphRow, context: GraphContext): void;
}

export interface GraphContext {
	readonly repoPath: string;
	readonly useAvatars: boolean;
	readonly branches: ReadonlyMap<string, GitBranch>;
	readonly remotes: ReadonlyMap<string, GitRemote>;
	readonly worktreesByBranch: ReadonlyMap<string, GitWorktree> | undefined;
	readonly branchIdOfMainWorktree: string | undefined;
	readonly stashes: ReadonlyMap<string, GitStashCommit> | undefined;
	readonly reachableFromHEAD: ReadonlySet<string>;
	/** SHAs on the first-parent chain from HEAD up to (excluding) the first merge commit — the commits
	 *  a plain interactive rebase can safely rewrite. Empty when HEAD is a merge. Sets the
	 *  {@link GitGraphRowContextFlags.RewriteableFromHead} flag, gating squash/drop/reword/modify. */
	readonly rewriteableFromHEAD: ReadonlySet<string>;
	/** The subset of undo-eligible tip shas (active HEAD + worktree HEADs) that have at least one
	 *  child — i.e. are NOT leaves. Scoped to tips (not all commits) for performance; do not treat as
	 *  a general has-children signal. Sets the {@link GitGraphRowContextFlags.HasChildren} flag, which
	 *  gates Undo Commit to leaf tips. */
	readonly tipShasWithChildren: ReadonlySet<string>;
	/** SHAs reachable from HEAD's tracking-upstream tip, or `undefined` when HEAD has no upstream.
	 * A commit reachable from HEAD but NOT from this set is unpushed (`+unpublished`); `undefined`
	 * means there's no upstream to be ahead of, so nothing is flagged. */
	readonly reachableFromHeadUpstream: ReadonlySet<string> | undefined;
	readonly avatars: Map<string, string>;
}
