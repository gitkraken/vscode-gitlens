import type { GitCommit, GitCommitIdentityShape } from '../models/commit.js';

export interface GitPatchSubProvider {
	apply(repoPath: string, patch: string, options?: { threeWay?: boolean }): Promise<void>;
	applyUnreachableCommitForPatch(
		repoPath: string,
		rev: string,
		options?: {
			branchName?: string;
			createBranchIfNeeded?: boolean;
			createWorktreePath?: string;
			stash?: boolean;
		},
	): Promise<void>;
	createUnreachableCommitForPatch(
		repoPath: string,
		base: string,
		message: string,
		patch: string,
		options?: { sign?: boolean; source?: unknown },
	): Promise<GitCommit | undefined>;
	createUnreachableCommitsFromPatches(
		repoPath: string,
		base: string | undefined,
		patches: { message: string; patch: string; author?: GitCommitIdentityShape }[],
		options?: { sign?: boolean; source?: unknown },
	): Promise<string[]>;
	createEmptyInitialCommit(repoPath: string): Promise<string>;

	validatePatch(repoPath: string | undefined, contents: string): Promise<boolean>;
}
