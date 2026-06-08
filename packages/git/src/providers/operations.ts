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
	/**
	 * Switches the repository to a branch or ref. Pure branch/ref switching — does not accept
	 * a path. For path-level operations use {@link restore}.
	 */
	checkout(
		repoPath: string,
		ref: string,
		options?: { createBranch?: string | undefined },
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
			/** Command set as `sequence.editor` — edits the interactive rebase todo list. */
			editor?: string;
			interactive?: boolean;
			/**
			 * Set when the `editor` is a script that rewrites the todo by command word + SHA (e.g. the
			 * Commit Graph's headless squash/drop/reword) rather than a human. Forces git to emit a plain,
			 * natural-order todo by disabling `rebase.autosquash` (which would reorder commits and rewrite
			 * `pick`→`fixup` for `fixup!`/`squash!` commits) and `rebase.abbreviateCommands` (which would
			 * emit `p` instead of `pick`). Both honor the user's git config otherwise.
			 */
			programmaticEditor?: boolean;
			/**
			 * Command git uses to edit per-commit messages (the combined message a `squash` produces, or a
			 * `reword`). Applied as `GIT_EDITOR` — which git's interactive-rebase `reword`/`squash` step honors,
			 * unlike `core.editor` — with `core.editor` also set as a fallback. When omitted, git falls back to
			 * the user's configured editor.
			 */
			messageEditor?: string;
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
	/**
	 * Restores the working-tree copy of one or more paths. Single path or array; arrays are
	 * chunked under the CLI length limit and dispatched as one git invocation per chunk
	 * (typically one for normal-sized batches).
	 *
	 * Source selection — `options` is mutually exclusive (`side` wins if both are supplied):
	 *
	 * - **No options** (`git checkout -- <paths>`): copies the index to the working tree, leaving
	 *   the index untouched. Use to drop unstaged changes (mixed-file partial discard preserves
	 *   the staged portion this way).
	 * - **`{ ref }`** (`git checkout <ref> -- <paths>`): resets BOTH the index and the working
	 *   tree of the path(s) to `<ref>`. Use to fully revert files to HEAD, a specific commit, etc.
	 * - **`{ side }`** (`git checkout --ours|--theirs -- <paths>`): conflict-resolution
	 *   shortcut, valid only during a paused merge/rebase/cherry-pick. Leaves files unstaged.
	 */
	restore(
		repoPath: string,
		path: string | string[],
		options?: { ref?: string; side?: 'ours' | 'theirs' },
		runOptions?: GitOperationRunOptions,
	): Promise<void>;
	revert(
		repoPath: string,
		refs: string[],
		options?: { editMessage?: boolean; source?: unknown },
		runOptions?: GitOperationRunOptions,
	): Promise<GitOperationResult>;
}
