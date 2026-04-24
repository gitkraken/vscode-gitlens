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

export interface OpenWorktreeCommandArgs extends BranchRef {
	location?: OpenWorkspaceLocation;
}

export interface CreatePullRequestCommandArgs {
	ref: BranchRef;
	describeWithAI?: boolean;
	source?: Source;
}
