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
}

export interface GitGraph {
	readonly repoPath: string;
	/** A map of all avatar urls */
	readonly avatars: Map<string, string>;
	/** A set of all "seen" commit ids */
	readonly ids: Set<string>;
	readonly includes: { stats?: boolean } | undefined;
	readonly branches: Map<string, GitBranch>;
	readonly remotes: Map<string, GitRemote>;
	readonly downstreams: Map<string, string[]>;
	readonly stashes: Map<string, GitStashCommit> | undefined;
	readonly worktrees: GitWorktree[] | undefined;
	readonly worktreesByBranch: Map<string, GitWorktree> | undefined;

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

	more?(limit: number, id?: string, cancellation?: CancellationToken): Promise<GitGraph | undefined>;
}

export type GitGraphRowsStats = Map<string, GitGraphRowStats>;
