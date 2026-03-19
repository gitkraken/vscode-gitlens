import type { GitBlameSubProvider } from '@gitlens/git/providers/blame.js';
import type { GitBranchesSubProvider } from '@gitlens/git/providers/branches.js';
import type { GitCommitsSubProvider } from '@gitlens/git/providers/commits.js';
import type { GitConfigSubProvider } from '@gitlens/git/providers/config.js';
import type { GitContributorsSubProvider } from '@gitlens/git/providers/contributors.js';
import type { GitDiffSubProvider } from '@gitlens/git/providers/diff.js';
import type { GitGraphSubProvider } from '@gitlens/git/providers/graph.js';
import type { GitRefsSubProvider } from '@gitlens/git/providers/refs.js';
import type { GitRemotesSubProvider } from '@gitlens/git/providers/remotes.js';
import type { GitRevisionSubProvider } from '@gitlens/git/providers/revision.js';
import type { GitStatusSubProvider } from '@gitlens/git/providers/status.js';
import type { GitTagsSubProvider } from '@gitlens/git/providers/tags.js';
import type { Uri } from '@gitlens/utils/uri.js';
import type { GitHubProviderContext, GitHubRepositoryContext } from '../context.js';

/**
 * The internal interface that GitHub sub-providers see of their parent provider.
 * Provides access to sibling sub-providers, the context, and shared utility methods.
 *
 * This mirrors {@link CliGitProviderInternal} for the GitHub provider.
 *
 * @internal Not intended for external consumers.
 */
export interface GitHubGitProviderInternal {
	readonly authenticationProviderId: string;

	readonly blame: GitBlameSubProvider;
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

	readonly context: GitHubProviderContext;

	/** Resolves the repository context (API client, metadata, session) for a given repoPath. */
	ensureRepositoryContext(repoPath: string, open?: boolean): Promise<GitHubRepositoryContext>;

	/** Gets the relative path between pathOrUri and a base URI. */
	getRelativePath(pathOrUri: Uri | string, base: Uri | string): string;

	/** Creates a provider URI (github scheme) for a specific revision. */
	createProviderUri(repoPath: string, rev: string, path?: string): Uri;

	/** Creates a virtual URI for a working copy view. */
	createVirtualUri(repoPath: string, rev: string | undefined, path?: string): Uri;

	/** Gets the best revision URI for a path at a given revision. */
	getBestRevisionUri(repoPath: string, path: string, rev: string | undefined): Promise<Uri | undefined>;

	/** Gets an absolute URI by joining a path to a base URI. */
	getAbsoluteUri(pathOrUri: string | Uri, base: string | Uri): Uri;

	/** Gets the provider root URI for a given URI (strips path down to the repo root). */
	getProviderRootUri(uri: Uri): Uri;

	/** Gets the effective paging limit. */
	getPagingLimit(limit?: number): number;
}
