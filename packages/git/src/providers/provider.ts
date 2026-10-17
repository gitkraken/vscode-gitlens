import type { Event } from '@gitlens/utils/event.js';
import type { Uri } from '@gitlens/utils/uri.js';
import type { CachedGitTypes, MergeTargetsChangeEvent } from '../cache.js';
import type { RepositoryChange } from '../models/repository.js';
import type { GitIgnoreFilter } from '../watching/gitIgnoreFilter.js';
import type { GitBlameSubProvider } from './blame.js';
import type { GitBranchesSubProvider } from './branches.js';
import type { GitCommitsSubProvider } from './commits.js';
import type { GitConfigSubProvider } from './config.js';
import type { GitContributorsSubProvider } from './contributors.js';
import type { GitDiffSubProvider } from './diff.js';
import type { GitGraphSubProvider } from './graph.js';
import type { GitMaintenanceSubProvider } from './maintenance.js';
import type { GitOperationRunOptions, GitOperationsSubProvider } from './operations.js';
import type { GitPatchSubProvider } from './patch.js';
import type { GitPausedOperationsSubProvider } from './pausedOperations.js';
import type { GitRefsSubProvider } from './refs.js';
import type { GitRemotesSubProvider } from './remotes.js';
import type { GitRevisionSubProvider } from './revision.js';
import type { GitStagingSubProvider } from './staging.js';
import type { GitStashSubProvider } from './stash.js';
import type { GitStatusSubProvider } from './status.js';
import type { GitTagsSubProvider } from './tags.js';
import type { GitProviderDescriptor } from './types.js';
import type { GitWorktreesSubProvider } from './worktrees.js';

export type { GitProviderDescriptor } from './types.js';

/**
 * Common interface for all git providers (CLI, GitHub, etc.).
 * Consumers can register multiple providers and route operations transparently.
 *
 * Core sub-providers are required; CLI-only sub-providers are optional.
 */
export interface GitProvider {
	readonly descriptor: GitProviderDescriptor;

	getAbsoluteUri(pathOrUri: string | Uri, base: string | Uri): Uri;
	getRelativePath(pathOrUri: string | Uri, base: string | Uri): string;

	clone?(
		url: string,
		parentPath: string,
		options?: {
			/** Used exactly, with no collision probing or auto-numbering; git itself refuses a non-empty target. */
			folderName?: string;
		},
		/** Spread into the run (`env`, `cancellation`, `timeout`) — the caller decides the timeout for a large clone. */
		runOptions?: GitOperationRunOptions,
	): Promise<string | undefined>;
	excludeIgnoredUris?(repoPath: string, uris: Uri[]): Promise<Uri[]>;
	getIgnoreFilter?(repoPath: string, gitDirPath: string): GitIgnoreFilter;
	/**
	 * The directories in the working tree that an ignore rule matches, as repo-relative `/`-separated paths — each
	 * to be pruned from a file watcher along with its subtree. Nested entries are collapsed into their outermost
	 * ancestor, and literal paths containing glob metacharacters are dropped (a watcher can't express them safely).
	 */
	getIgnoredDirectories?(repoPath: string, cancellation?: AbortSignal): Promise<string[]>;
	/**
	 * The working tree's ignored entries as repo-relative `/`-separated paths, the way `git status --ignored` lists
	 * them: an ignored file is one entry, and a directory whose entire contents are ignored is one entry with a
	 * trailing `/` (its contents aren't listed). Empty directories and `.git/` aren't listed. Sorted, and not capped —
	 * the caller limits what it shows. Unlike `getIgnoredDirectories` this is a listing, not a watcher-pruning set, so
	 * nothing is dropped or re-confirmed against the rules.
	 */
	getIgnoredEntries?(repoPath: string, cancellation?: AbortSignal): Promise<string[]>;
	/**
	 * An exact check of which of `paths` (repo-relative) git's ignore rules match — the subset that is ignored, as
	 * given. A tracked file isn't reported as ignored, even when a rule matches it. This is git's answer, where the
	 * in-memory `GitIgnoreFilter` errs toward not-ignored.
	 */
	getIgnoredPaths?(repoPath: string, paths: readonly string[], cancellation?: AbortSignal): Promise<Set<string>>;
	getIgnoredUrisFilter?(repoPath: string): Promise<(uri: Uri) => boolean>;
	getLastFetchedTimestamp?(repoPath: string): Promise<number | undefined>;
	/**
	 * Fires when an external write changed a branch's merge-relevant `.git/gk/config` keys — not for activity
	 * timestamps, and not for the provider's own writes. See `Cache.onDidChangeMergeTargets`.
	 */
	readonly onDidChangeMergeTargets?: Event<MergeTargetsChangeEvent>;
	/** Creates a new repository at `path` (`git init`), creating `path` itself if it doesn't yet exist. */
	init?(path: string, options?: { defaultBranch?: string; bare?: boolean }): Promise<void>;
	/**
	 * Notifies the provider that `repoPath` was mutated outside of a typed sub-provider method — e.g. a
	 * consumer that ran a command through the raw `git.run`/`provider.git.run` escape hatch. Fires the same
	 * `cache.onReset`/`repository.onChanged` hooks a typed mutator would, so, exactly as after a typed write,
	 * the provider clears its own caches for `repoPath` and the repository's pending commands before the
	 * host's handlers run.
	 *
	 * What is reset: `options.cache` when given (`'all'` for everything, `[]` for nothing); otherwise the
	 * cache types `changes` map to, the same mapping a file watcher's changes get. An empty `changes`, or one
	 * naming `'unknown'` or `'closed'`, resets everything. Changes that map to no cache type (e.g.
	 * `'starred'`) reset nothing and fire no `onReset`; `onChanged` always fires.
	 */
	notifyChanged?(
		repoPath: string,
		changes: readonly RepositoryChange[],
		options?: { cache?: readonly CachedGitTypes[] | 'all' },
	): void;

	readonly branches: GitBranchesSubProvider;
	readonly commits: GitCommitsSubProvider;
	readonly config: GitConfigSubProvider;
	readonly contributors: GitContributorsSubProvider;
	readonly diff: GitDiffSubProvider;
	readonly graph: GitGraphSubProvider;
	readonly refs: GitRefsSubProvider;
	readonly remotes: GitRemotesSubProvider;
	readonly revision: GitRevisionSubProvider;
	readonly status: GitStatusSubProvider;
	readonly tags: GitTagsSubProvider;

	readonly blame?: GitBlameSubProvider;
	readonly maintenance?: GitMaintenanceSubProvider;
	readonly ops?: GitOperationsSubProvider;
	readonly patch?: GitPatchSubProvider;
	readonly pausedOps?: GitPausedOperationsSubProvider;
	readonly staging?: GitStagingSubProvider;
	readonly stash?: GitStashSubProvider;
	readonly worktrees?: GitWorktreesSubProvider;
}
