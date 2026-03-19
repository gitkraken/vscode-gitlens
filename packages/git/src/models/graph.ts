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
 * Context data attached to graph row regions for command/menu handling.
 * Structurally compatible with @gitkraken/gitkraken-components RowContexts.
 */
export interface GitGraphRowContexts {
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
	reachableFromBranches?: string[];
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
	/** Map of SHA → set of branch names reachable from that SHA (for enrichment: branch context) */
	readonly reachableFromBranches?: ReadonlyMap<string, ReadonlySet<string>>;

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
	readonly reachableFromBranches: ReadonlyMap<string, ReadonlySet<string>>;
	readonly avatars: Map<string, string>;
}
