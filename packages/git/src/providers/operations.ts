import type { GitBranchReference, GitReference } from '../models/reference.js';
import type { GitConflictFile } from '../models/staging.js';
import type { GitRunOptions } from '../run.types.js';

export interface GitOperationResult {
	readonly conflicted: boolean;
	/** Populated when {@link conflicted} is `true`. May be empty if the conflict file list couldn't be read. */
	readonly conflicts?: GitConflictFile[];
}

/**
 * Spawn-layer overrides callers can pass to user-initiated git operations to inject per-call
 * environment variables, an `AbortSignal` for cancellation, or a custom `timeout`. Forwarded
 * verbatim to the underlying `git.run(...)` invocation; cannot override op-owned fields like
 * `cwd`, `configs`, `errors`, or `stdin`.
 *
 * Note: passing `timeout` overrides per-op safety defaults. `merge`, `rebase`, and `revert`
 * intentionally disable the timeout (set it to 0) because those operations can take a long
 * time; a caller-supplied `timeout` will replace that "no timeout" setting, so use with care.
 */
export type GitOperationRunOptions = Pick<GitRunOptions, 'env' | 'cancellation' | 'timeout'>;

export interface GitOperationsSubProvider {
	checkout(
		repoPath: string,
		ref: string,
		options?: { createBranch?: string | undefined } | { path?: string | undefined },
		runOptions?: GitOperationRunOptions,
	): Promise<void>;
	/**
	 * Checks out one side of a conflicted path during a paused merge/rebase/cherry-pick.
	 * Executes `git checkout --ours|--theirs -- <path>`, leaving the file unstaged.
	 */
	checkoutConflictedPath(
		repoPath: string,
		path: string,
		side: 'ours' | 'theirs',
		runOptions?: GitOperationRunOptions,
	): Promise<void>;
	/**
	 * Checks out one side for multiple conflicted paths during a paused merge/rebase/cherry-pick.
	 * Batches paths into `git checkout --ours|--theirs -- <paths...>`, chunked to stay under the
	 * CLI length limit. Leaves files unstaged.
	 */
	checkoutConflictedPaths(
		repoPath: string,
		paths: string[],
		side: 'ours' | 'theirs',
		runOptions?: GitOperationRunOptions,
	): Promise<void>;
	cherryPick(
		repoPath: string,
		revs: string[],
		options?: { edit?: boolean; noCommit?: boolean; source?: unknown },
		runOptions?: GitOperationRunOptions,
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
		runOptions?: GitOperationRunOptions,
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
		runOptions?: GitOperationRunOptions,
	): Promise<void>;
	merge(
		repoPath: string,
		ref: string,
		options?: { fastForward?: boolean | 'only'; noCommit?: boolean; squash?: boolean; source?: unknown },
		runOptions?: GitOperationRunOptions,
	): Promise<GitOperationResult>;
	pull(
		repoPath: string,
		options?: {
			branch?: GitBranchReference | undefined;
			rebase?: boolean | undefined;
			tags?: boolean | undefined;
			source?: unknown;
		},
		runOptions?: GitOperationRunOptions,
	): Promise<void>;
	push(
		repoPath: string,
		options?: {
			reference?: GitReference | undefined;
			force?: boolean | undefined;
			publish?: { remote: string };
		},
		runOptions?: GitOperationRunOptions,
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
		runOptions?: GitOperationRunOptions,
	): Promise<GitOperationResult>;
	reset(
		repoPath: string,
		rev: string,
		options?: { mode?: 'hard' | 'keep' | 'merge' | 'mixed' | 'soft' },
		runOptions?: GitOperationRunOptions,
	): Promise<void>;
	revert(
		repoPath: string,
		refs: string[],
		options?: { editMessage?: boolean; source?: unknown },
		runOptions?: GitOperationRunOptions,
	): Promise<GitOperationResult>;
}
