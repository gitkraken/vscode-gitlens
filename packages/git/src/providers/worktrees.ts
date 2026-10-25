import type { Uri } from '@gitlens/utils/uri.js';
import type { GitWorktree } from '../models/worktree.js';
import type { GitOperationRunOptions } from './operations.js';

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
		runOptions?: GitOperationRunOptions,
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
		runOptions?: GitOperationRunOptions,
	): Promise<GitWorktree | undefined>;
	getWorktree(
		repoPath: string,
		predicate: (w: GitWorktree) => boolean,
		/** `force`: searches a fresh list, as {@link getWorktrees} reads it */
		options?: { force?: boolean },
		cancellation?: AbortSignal,
	): Promise<GitWorktree | undefined>;
	getWorktrees(
		repoPath: string,
		/**
		 * `force`: re-reads `git worktree list` rather than answer from the cached list or a read whose git process
		 * started before this call (a pending read that hasn't started one yet is joined), and stores the fresh
		 * answer. When the list disagrees with the cached branch list, the branch caches are refreshed once (and
		 * a worktree's own when its branch changed); otherwise they are left alone. Not a substitute for a
		 * `'worktrees'` reset: with the branch list current it keeps the cached git results and merge targets, which
		 * a reset after a sibling worktree's checkout evicts.
		 */
		options?: { force?: boolean },
		cancellation?: AbortSignal,
	): Promise<GitWorktree[]>;
	getWorktreesDefaultUri(repoPath: string): Uri | undefined;
	/**
	 * Deletes a worktree. Pass `force: 'locked'` to also override a locked worktree.
	 *
	 * `runOptions` are spread into the underlying git invocation (e.g. `{ timeout: 0 }` for a large
	 * worktree whose removal may exceed the default command timeout).
	 *
	 * On failure, the thrown error's `original` property carries the raw underlying error (stderr/stdout
	 * included) untouched, for a caller that needs to classify a platform-specific failure itself.
	 */
	deleteWorktree(
		repoPath: string,
		path: string | Uri,
		options?: { force?: boolean | 'locked' },
		runOptions?: GitOperationRunOptions,
	): Promise<void>;
	/**
	 * Removes administrative files for worktrees whose working directory no longer exists
	 * (`git worktree prune`). Pass `expire` to only prune worktrees that have been inaccessible for longer than the given time.
	 */
	pruneWorktrees(repoPath: string, options?: { expire?: string }): Promise<void>;
	/** Locks a worktree against removal/pruning, optionally recording a reason. */
	lockWorktree(repoPath: string, path: string | Uri, options?: { reason?: string }): Promise<void>;
	unlockWorktree(repoPath: string, path: string | Uri): Promise<void>;
}
