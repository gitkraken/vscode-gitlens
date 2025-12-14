import type {
	GraphRow,
	Head,
	HostingServiceType,
	Remote,
	RowContexts,
	RowStats,
	Tag,
} from '@gitkraken/gitkraken-components';
import type { CancellationToken } from 'vscode';
import type { GitBranch } from './branch';
import type { GitStashCommit } from './commit';
import type { GitRemote } from './remote';
import type { GitWorktree } from './worktree';

export type GitGraphHostingServiceType = HostingServiceType;

export type GitGraphRowHead = Head;
export type GitGraphRowRemoteHead = Remote;
export type GitGraphRowTag = Tag;
export type GitGraphRowContexts = RowContexts;
export type GitGraphRowStats = RowStats;
export type GitGraphRowType =
	| 'commit-node'
	| 'merge-node'
	| 'stash-node'
	| 'work-dir-changes'
	| 'merge-conflict-node'
	| 'unsupported-rebase-warning-node';

export interface GitGraphRow extends GraphRow {
	type: GitGraphRowType;
	heads?: GitGraphRowHead[];
	remotes?: GitGraphRowRemoteHead[];
	tags?: GitGraphRowTag[];
	contexts?: GitGraphRowContexts;
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
	more?(limit: number, id?: string, cancellation?: CancellationToken): Promise<GitGraph | undefined>;
}

export type GitGraphRowsStats = Map<string, GitGraphRowStats>;
