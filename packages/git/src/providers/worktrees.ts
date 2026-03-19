import type { Uri } from '@gitlens/utils/uri.js';
import type { GitWorktree } from '../models/worktree.js';

export interface GitWorktreesSubProvider {
	createWorktree(
		repoPath: string,
		path: string,
		options?: { commitish?: string; createBranch?: string; detach?: boolean; force?: boolean },
	): Promise<void>;
	createWorktreeWithResult(
		repoPath: string,
		path: string,
		options?: { commitish?: string; createBranch?: string; detach?: boolean; force?: boolean },
	): Promise<GitWorktree | undefined>;
	getWorktree(
		repoPath: string,
		predicate: (w: GitWorktree) => boolean,
		cancellation?: AbortSignal,
	): Promise<GitWorktree | undefined>;
	getWorktrees(repoPath: string, cancellation?: AbortSignal): Promise<GitWorktree[]>;
	getWorktreesDefaultUri(repoPath: string): Uri | undefined;
	deleteWorktree(repoPath: string, path: string | Uri, options?: { force?: boolean }): Promise<void>;
}
