import type { Source } from '../../constants.telemetry.js';
import type { OpenWorkspaceLocation } from '../../system/-webview/vscode/workspaces.js';

export interface BranchRef {
	repoPath: string;
	branchId: string;
	branchName: string;
	branchUpstreamName?: string;
	worktree?: {
		name: string;
		isDefault: boolean;
	};
}

export interface BranchAndTargetRefs extends BranchRef {
	mergeTargetId: string;
	mergeTargetName: string;
}

/** A branch to delete, with the optional context the delete wizard uses to pick its defaults */
export type DeleteBranchOrWorktreeRefs = BranchRef & {
	/** The branch it landed in, used to pre-select safe-delete behavior */
	mergeTarget?: BranchRef;
	/** Only PR evidence may pass this — it pre-selects Force Delete */
	mergedPullRequest?: { id: string; sha: string };
};

export interface OpenWorktreeCommandArgs extends BranchRef {
	location?: OpenWorkspaceLocation;
}

export interface CreatePullRequestCommandArgs {
	ref: BranchRef;
	describeWithAI?: boolean;
	source?: Source;
}
