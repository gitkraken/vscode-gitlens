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
	worktreeId?: string;
}

export interface GitGraphRowRemoteHead {
	id?: string;
	name: string;
	url?: string;
	owner: string;
	avatarUrl?: string;
	context?: string | object;
	current?: boolean;
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
 * Bit 0: reachable-from-HEAD (`+current`); Bit 1: unique-to-one-local-branch (`+unique`).
 * (`+HEAD` derives from `row.heads[].isCurrentHead`; contributor `+current` from `row.isCurrentUser`.)
 */
export const enum GitGraphRowContextFlags {
	None = 0,
	ReachableFromHead = 1 << 0,
	UniqueToBranch = 1 << 1,
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
	readonly avatars: Map<string, string>;
}
