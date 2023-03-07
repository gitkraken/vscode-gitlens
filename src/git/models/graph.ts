import type { GraphRow, Head, Remote, RowContexts, RowStats, Tag } from '@gitkraken/gitkraken-components';
import type { GitBranch } from './branch';
import type { GitRemote } from './remote';

export type GitGraphRowHead = Head;
export type GitGraphRowRemoteHead = Remote;
export type GitGraphRowTag = Tag;
export type GitGraphRowContexts = RowContexts;
export type GitGraphRowStats = RowStats;
export const enum GitGraphRowType {
	Commit = 'commit-node',
	MergeCommit = 'merge-node',
	Stash = 'stash-node',
	Working = 'work-dir-changes',
	Conflict = 'merge-conflict-node',
	Rebase = 'unsupported-rebase-warning-node',
}

export interface GitGraphRow extends GraphRow {
	type: GitGraphRowType;
	heads?: GitGraphRowHead[];
	remotes?: GitGraphRowRemoteHead[];
	tags?: GitGraphRowTag[];
	contexts?: GitGraphRowContexts;
	stats?: GitGraphRowStats;
}

export interface GitGraph {
	readonly repoPath: string;
	/** A map of all avatar urls */
	readonly avatars: Map<string, string>;
	/** A set of all "seen" commit ids */
	readonly ids: Set<string>;
	readonly includes: { stats?: boolean } | undefined;
	/** A set of all skipped commit ids -- typically for stash index/untracked commits */
	readonly skippedIds?: Set<string>;
	readonly branches: Map<string, GitBranch>;
	readonly remotes: Map<string, GitRemote>;
	readonly downstreams: Map<string, string[]>;
	/** The rows for the set of commits requested */
	readonly rows: GitGraphRow[];
	readonly id?: string;

	readonly paging?: {
		readonly limit: number | undefined;
		readonly startingCursor: string | undefined;
		readonly hasMore: boolean;
	};

	more?(limit: number, id?: string): Promise<GitGraph | undefined>;
}
