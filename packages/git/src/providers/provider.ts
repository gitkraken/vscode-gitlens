import type { Uri } from '@gitlens/utils/uri.js';
import type { GitIgnoreFilter } from '../watching/gitIgnoreFilter.js';
import type { GitBlameSubProvider } from './blame.js';
import type { GitBranchesSubProvider } from './branches.js';
import type { GitCommitsSubProvider } from './commits.js';
import type { GitConfigSubProvider } from './config.js';
import type { GitContributorsSubProvider } from './contributors.js';
import type { GitDiffSubProvider } from './diff.js';
import type { GitGraphSubProvider } from './graph.js';
import type { GitOperationsSubProvider } from './operations.js';
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

	clone?(url: string, parentPath: string): Promise<string | undefined>;
	excludeIgnoredUris?(repoPath: string, uris: Uri[]): Promise<Uri[]>;
	getIgnoreFilter?(repoPath: string, gitDirPath: string): GitIgnoreFilter;
	getIgnoredUrisFilter?(repoPath: string): Promise<(uri: Uri) => boolean>;
	getLastFetchedTimestamp?(repoPath: string): Promise<number | undefined>;

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
	readonly ops?: GitOperationsSubProvider;
	readonly patch?: GitPatchSubProvider;
	readonly pausedOps?: GitPausedOperationsSubProvider;
	readonly staging?: GitStagingSubProvider;
	readonly stash?: GitStashSubProvider;
	readonly worktrees?: GitWorktreesSubProvider;
}
