import type { GitBranch, GitBranchStatus, GitTrackingState, GitTrackingUpstream } from '@gitlens/git/models/branch.js';
import type { GitDiffFileStats } from '@gitlens/git/models/diff.js';
import type { Issue } from '@gitlens/git/models/issue.js';
import type { ConflictDetectionResult } from '@gitlens/git/models/mergeConflicts.js';
import type { GitPausedOperationStatus } from '@gitlens/git/models/pausedOperationStatus.js';
import type { GitBranchReference } from '@gitlens/git/models/reference.js';
import type { RemoteProviderSupportedFeatures } from '@gitlens/git/models/remoteProvider.js';
import type { GitWorktree } from '@gitlens/git/models/worktree.js';
import type { GitBranchMergedStatus } from '@gitlens/git/providers/branches.js';
import { getReferenceFromBranch } from '../../git/utils/-webview/reference.utils.js';
import type { LaunchpadItem } from '../../plus/launchpad/launchpadProvider.js';
import type { LaunchpadGroup } from '../../plus/launchpad/models/launchpad.js';

export type OverviewRecentThreshold = 'OneDay' | 'OneWeek' | 'OneMonth';
export type OverviewStaleThreshold = 'OneYear';

/** Branch data with only synchronous fields. Used for fast initial render before enrichment. */
export interface OverviewBranch {
	reference: GitBranchReference;
	repoPath: string;
	id: string;
	name: string;
	opened: boolean;
	timestamp?: number;
	status: GitBranchStatus;
	upstream: GitTrackingUpstream | undefined;
	worktree?: {
		name: string;
		uri: string;
		isDefault: boolean;
	};
}

export const overviewThresholdValues: Record<OverviewStaleThreshold | OverviewRecentThreshold, number> = {
	OneDay: 1000 * 60 * 60 * 24 * 1,
	OneWeek: 1000 * 60 * 60 * 24 * 7,
	OneMonth: 1000 * 60 * 60 * 24 * 30,
	OneYear: 1000 * 60 * 60 * 24 * 365,
};

export function toOverviewBranch(
	branch: GitBranch,
	worktreesByBranch: ReadonlyMap<string, GitWorktree>,
	opened: boolean,
): OverviewBranch {
	const wt = worktreesByBranch.get(branch.id);
	return {
		reference: getReferenceFromBranch(branch),
		repoPath: branch.repoPath,
		id: branch.id,
		name: branch.name,
		opened: opened,
		timestamp: branch.effectiveDate?.getTime(),
		status: branch.status,
		upstream: branch.upstream,
		worktree: wt ? { name: wt.name, uri: wt.uri.toString(), isDefault: wt.isDefault } : undefined,
	};
}

export function getBranchOverviewType(
	branch: GitBranch,
	worktreesByBranch: ReadonlyMap<string, GitWorktree>,
	recentThreshold: OverviewRecentThreshold,
	staleThreshold: OverviewStaleThreshold,
): 'active' | 'recent' | 'stale' | undefined {
	if (branch.current || worktreesByBranch.get(branch.id)?.opened) {
		return 'active';
	}

	const timestamp = branch.effectiveDate?.getTime();
	if (timestamp != null) {
		const now = Date.now();

		const recentMs = now - overviewThresholdValues[recentThreshold];
		if (timestamp > recentMs) {
			return 'recent';
		}

		const staleMs = now - overviewThresholdValues[staleThreshold];
		if (timestamp < staleMs) {
			return 'stale';
		}
	}

	if (branch.upstream?.missing) {
		return 'stale';
	}

	return undefined;
}

/** WIP data keyed by branch ID. Only branches with worktrees or active branches have WIP. */
export type GetOverviewWipResponse = Record<string, OverviewBranchWip | undefined>;

/** Lightweight overview WIP data — sourced from local git status only. */
export interface OverviewBranchWip {
	workingTreeState?: GitDiffFileStats;
	hasConflicts?: boolean;
	conflictsCount?: number;
	pausedOpStatus?: GitPausedOperationStatus;
}

/** Enrichment data keyed by branch ID. Expensive — sourced from API calls and git log. */
export type GetOverviewEnrichmentResponse = Record<string, OverviewBranchEnrichment>;

export interface OverviewBranchEnrichment {
	remote?: OverviewBranchRemote;
	pr?: OverviewBranchPullRequest;
	/** Resolved launchpad data for IPC serialization (Promises don't survive postMessage). */
	resolvedLaunchpad?: OverviewBranchLaunchpadItem;
	autolinks?: OverviewBranchIssue[];
	issues?: OverviewBranchIssue[];
	contributors?: OverviewBranchContributor[];
	mergeTarget?: OverviewBranchMergeTarget;
}

export interface OverviewBranchRemote {
	name: string;
	provider?: {
		name: string;
		icon?: string;
		url?: string;
		supportedFeatures: RemoteProviderSupportedFeatures;
	};
}

export interface OverviewBranchPullRequest {
	id: string;
	title: string;
	state: string;
	url: string;
	draft?: boolean;
	launchpad?: Promise<OverviewBranchLaunchpadItem | undefined>;
}

export interface OverviewBranchLaunchpadItem {
	uuid: string;
	category: LaunchpadItem['actionableCategory'];
	groups: LaunchpadGroup[];
	suggestedActions: LaunchpadItem['suggestedActions'];

	failingCI: boolean;
	hasConflicts: boolean;

	author: LaunchpadItem['author'];
	createdDate: LaunchpadItem['createdDate'];

	review: {
		decision: LaunchpadItem['reviewDecision'];
		reviews: NonNullable<LaunchpadItem['reviews']>;
		counts: {
			approval: number;
			changeRequest: number;
			comment: number;
			codeSuggest: number;
		};
	};

	viewer: LaunchpadItem['viewer'];
}

export interface OverviewBranchIssue {
	id: string;
	title: string;
	url: string;
	state: Omit<Issue['state'], 'merged'>;
	/** Stable identifier used to unassociate from a branch; populated only for manually-associated issues. */
	entityId?: string;
}

export interface OverviewBranchContributor {
	name: string;
	email: string;
	avatarUrl: string;
	current: boolean;
	timestamp?: number;
	count: number;
	stats?: {
		files: number;
		additions: number;
		deletions: number;
	};
}

export interface OverviewBranchMergeTarget {
	repoPath: string;
	id: string;
	/** Tip SHA of the target branch. Used by the graph's scoped view to anchor the merge-target marker without scanning loaded rows. */
	sha: string;
	name: string;
	status?: GitTrackingState;
	mergedStatus?: GitBranchMergedStatus;
	potentialConflicts?: ConflictDetectionResult;
	targetBranch: string | undefined;
	baseBranch: string | undefined;
	defaultBranch: string | undefined;
}
