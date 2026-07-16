import type { Uri } from '@gitlens/utils/uri.js';
import type { GitWorktree } from '../models/worktree.js';

export interface GitWorktreesSubProvider {
	createWorktree(
		repoPath: string,
		path: string,
		options?: {
			commitish?: string;
			createBranch?: string;
			detach?: boolean;
			force?: boolean;
			noTracking?: boolean;
		},
	): Promise<void>;
	createWorktreeWithResult(
		repoPath: string,
		path: string,
		options?: {
			commitish?: string;
			createBranch?: string;
			detach?: boolean;
			force?: boolean;
			noTracking?: boolean;
		},
	): Promise<GitWorktree | undefined>;
	getWorktree(
		repoPath: string,
		predicate: (w: GitWorktree) => boolean,
		cancellation?: AbortSignal,
	): Promise<GitWorktree | undefined>;
	getWorktrees(repoPath: string, cancellation?: AbortSignal): Promise<GitWorktree[]>;
	getWorktreesDefaultUri(repoPath: string): Uri | undefined;
	/** Pass `force: 'locked'` to also override a locked worktree */
	deleteWorktree(repoPath: string, path: string | Uri, options?: { force?: boolean | 'locked' }): Promise<void>;
	unlockWorktree(repoPath: string, path: string | Uri): Promise<void>;
}
