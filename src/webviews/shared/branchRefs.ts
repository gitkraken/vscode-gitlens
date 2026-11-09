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

/** A branch to delete, sent as one object since webview command links can't carry positional args */
export type DeleteBranchOrWorktreeRefs = BranchRef & {
	/** The branch to switch to when deleting the current branch */
	mergeTarget?: BranchRef;
};

export interface OpenWorktreeCommandArgs extends BranchRef {
	location?: OpenWorkspaceLocation;
}

export interface CreatePullRequestCommandArgs {
	ref: BranchRef;
	describeWithAI?: boolean;
	source?: Source;
}
