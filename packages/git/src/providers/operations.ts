import type { GitBranchReference, GitReference } from '../models/reference.js';
import type { GitConflictFile } from '../models/staging.js';

export interface GitOperationResult {
	readonly conflicted: boolean;
	/** Populated when {@link conflicted} is `true`. May be empty if the conflict file list couldn't be read. */
	readonly conflicts?: GitConflictFile[];
}

export interface GitOperationsSubProvider {
	checkout(
		repoPath: string,
		ref: string,
		options?: { createBranch?: string | undefined } | { path?: string | undefined },
	): Promise<void>;
	/**
	 * Checks out one side of a conflicted path during a paused merge/rebase/cherry-pick.
	 * Executes `git checkout --ours|--theirs -- <path>`, leaving the file unstaged.
	 */
	checkoutConflictedPath(repoPath: string, path: string, side: 'ours' | 'theirs'): Promise<void>;
	/**
	 * Checks out one side for multiple conflicted paths during a paused merge/rebase/cherry-pick.
	 * Batches paths into `git checkout --ours|--theirs -- <paths...>`, chunked to stay under the
	 * CLI length limit. Leaves files unstaged.
	 */
	checkoutConflictedPaths(repoPath: string, paths: string[], side: 'ours' | 'theirs'): Promise<void>;
	cherryPick(
		repoPath: string,
		revs: string[],
		options?: { edit?: boolean; noCommit?: boolean; source?: unknown },
	): Promise<GitOperationResult>;
	commit(
		repoPath: string,
		message: string,
		options?: {
			all?: boolean;
			allowEmpty?: boolean;
			amend?: boolean;
			author?: string;
			date?: string;
			signoff?: boolean;
			source?: unknown;
		},
	): Promise<void>;
	fetch(
		repoPath: string,
		options?: {
			all?: boolean | undefined;
			branch?: GitBranchReference | undefined;
			prune?: boolean | undefined;
			pull?: boolean | undefined;
			remote?: string | undefined;
		},
	): Promise<void>;
	merge(
		repoPath: string,
		ref: string,
		options?: { fastForward?: boolean | 'only'; noCommit?: boolean; squash?: boolean; source?: unknown },
	): Promise<GitOperationResult>;
	pull(
		repoPath: string,
		options?: {
			branch?: GitBranchReference | undefined;
			rebase?: boolean | undefined;
			tags?: boolean | undefined;
			source?: unknown;
		},
	): Promise<void>;
	push(
		repoPath: string,
		options?: {
			reference?: GitReference | undefined;
			force?: boolean | undefined;
			publish?: { remote: string };
		},
	): Promise<void>;
	rebase(
		repoPath: string,
		upstream: string,
		options?: {
			autoStash?: boolean;
			branch?: string;
			editor?: string;
			interactive?: boolean;
			onto?: string;
			updateRefs?: boolean;
			source?: unknown;
		},
	): Promise<GitOperationResult>;
	reset(
		repoPath: string,
		rev: string,
		options?: { mode?: 'hard' | 'keep' | 'merge' | 'mixed' | 'soft' },
	): Promise<void>;
	revert(
		repoPath: string,
		refs: string[],
		options?: { editMessage?: boolean; source?: unknown },
	): Promise<GitOperationResult>;
}
