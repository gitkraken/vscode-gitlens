import type { CommitKind, GraphCommit } from '@gitkraken/commit-graph/engine/types.js';

/** Opaque host/provider identifier; known values select richer glyphs and unknown values stay generic. */
export type CommitGraphHostingServiceType = string;

/** Host-neutral row shape accepted by the renderer. Product adapters may carry additional fields. */
export interface CommitGraphSourceRow {
	sha: string;
	parents: string[];
	author: string;
	email: string;
	date: number;
	commitDate?: number;
	message: string;
	kind: CommitKind;
	heads?: CommitGraphSourceHead[];
	remotes?: CommitGraphSourceRemote[];
	tags?: CommitGraphSourceTag[];
	contexts?: CommitGraphSourceContexts;
	stats?: CommitGraphRowStats;
	stashNumber?: string;
	isCurrentUser?: boolean;
}

export interface CommitGraphSourceHead {
	id?: string;
	name: string;
	isCurrentHead: boolean;
	upstream?: { name: string; id: string; missing?: boolean; state?: { ahead: number; behind: number } };
	starred?: boolean;
	worktree?: { id: string; path: string; isDefault: boolean };
	isDefault?: boolean;
}

export interface CommitGraphSourceRemote {
	id?: string;
	name: string;
	url?: string;
	owner: string;
	avatarUrl?: string;
	current?: boolean;
	isDefault?: boolean;
	hostingServiceType?: CommitGraphHostingServiceType;
	starred?: boolean;
}

export interface CommitGraphSourceTag {
	id?: string;
	name: string;
	annotated: boolean;
}

export interface CommitGraphSourceContexts {
	/** Product-defined bit field. The product adapter interprets it; the renderer treats it as opaque. */
	flags?: number;
	reachabilityIndex?: number;
	row?: string | object;
	refGroups?: Record<string, string | object>;
}

export interface CommitGraphRowStats {
	files: number;
	additions: number;
	deletions: number;
}

/** A structured ref carried on the renderer's canonical commit view. */
export interface CommitGraphRef {
	kind: 'head' | 'remote' | 'tag';
	name: string;
	id?: string;
	current?: boolean;
	owner?: string;
	upstreamName?: string;
	upstreamId?: string;
	secondaryWorktreeId?: string;
	isDefault?: boolean;
	hostingServiceType?: CommitGraphHostingServiceType;
	context?: string;
	refContext?: string;
}

/** Canonical commit payload rendered after a host adapter has enriched a source row. */
export interface CommitGraphView extends GraphCommit {
	commitRefs: CommitGraphRef[];
	isUnpublished: boolean;
	isUnpulled: boolean;
	undo?: { worktreePath?: string; branchName?: string };
	avatarContextData?: string;
}

/**
 * Converts one host-neutral source row to its canonical render payload. The engine invokes it only
 * while reconciling a changed source row; ordinary Lit renders do not cross this boundary.
 */
export type CommitGraphRowAdapter<TRow extends CommitGraphSourceRow = CommitGraphSourceRow> = (
	row: TRow,
	idLength: number,
	repoPath?: string,
	pinnedRefId?: string,
) => CommitGraphView;

/**
 * Product-neutral adapter used when a consumer does not need product-specific context menus or row
 * actions. It performs one structured-ref pass when a source row enters the engine and allocates
 * nothing during ordinary row renders.
 */
export const defaultCommitGraphRowAdapter: CommitGraphRowAdapter = (row, idLength): CommitGraphView => ({
	sha: row.sha,
	shortSha: row.sha.slice(0, Math.max(4, Math.min(40, idLength))),
	message: row.message,
	author: row.author,
	authorEmail: row.email,
	date: row.date,
	parents: row.parents,
	kind: row.kind,
	commitRefs: [
		...(row.heads?.map(head => ({
			kind: 'head' as const,
			name: head.name,
			id: head.id,
			current: head.isCurrentHead,
			upstreamName: head.upstream?.name,
			upstreamId: head.upstream?.id,
			secondaryWorktreeId: head.worktree != null && !head.worktree.isDefault ? head.worktree.id : undefined,
			isDefault: head.isDefault,
		})) ?? []),
		...(row.remotes?.map(remote => ({
			kind: 'remote' as const,
			name: remote.name,
			id: remote.id,
			owner: remote.owner,
			current: remote.current,
			isDefault: remote.isDefault,
			hostingServiceType: remote.hostingServiceType,
		})) ?? []),
		...(row.tags?.map(tag => ({ kind: 'tag' as const, name: tag.name, id: tag.id })) ?? []),
	],
	isUnpublished: false,
	isUnpulled: false,
});
