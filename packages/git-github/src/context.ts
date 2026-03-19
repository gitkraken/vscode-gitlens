import type { GitServiceConfig, GitServiceContext } from '@gitlens/git/context.js';
import type { Uri } from '@gitlens/utils/uri.js';
import type { GitHubApiClient } from './api/types.js';

/**
 * Extends {@link GitServiceContext} with GitHub-specific capabilities.
 * The consumer (e.g., the VS Code extension) implements these
 * to bridge VS Code authentication, Remote Hub, and workspace.fs.
 */
export interface GitHubProviderContext extends GitServiceContext {
	/** GitHub-specific config extending the base with API pagination settings. */
	readonly config?: GitHubServiceConfig;

	/**
	 * Checks if a file in a virtual workspace repo has local uncommitted changes.
	 * The host implements this by comparing mtime of the working copy vs committed version
	 * (e.g., `vscode-vfs://` vs `github://` URIs via `workspace.fs.stat()`).
	 * Returns false if the repo is not a virtual workspace.
	 */
	hasUncommittedChanges?(repoPath: string, path: string): Promise<boolean>;

	/**
	 * Resolves the repository context (API client, metadata, session) for a given repoPath.
	 * This replaces the extension's `ensureRepositoryContext()` method, which talks
	 * to Remote Hub, VS Code auth, and the Container.
	 */
	resolveRepositoryContext(repoPath: string, open?: boolean): Promise<GitHubRepositoryContext>;

	/** URI construction and path resolution for remote/virtual workspaces. */
	readonly uris: GitHubUriProvider;
}

/** Extends base config with GitHub API pagination settings. */
export interface GitHubServiceConfig extends GitServiceConfig {
	readonly paging?: {
		/** Per-page limit for API calls (max 100, default 100). */
		readonly limit?: number;
	};
}

/** URI construction and path resolution for remote/virtual workspaces. */
export interface GitHubUriProvider {
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
}

/**
 * The resolved repository context returned by {@link GitHubProviderContext.resolveRepositoryContext}.
 * Contains everything a sub-provider needs to make API calls for a specific repo.
 */
export interface GitHubRepositoryContext {
	/** The GitHub API client for Git data operations. */
	readonly github: GitHubApiClient;
	/** Repository metadata (owner, name, current revision). */
	readonly metadata: GitHubRepoMetadata;
	/** Authentication session info. */
	readonly session: GitHubSession;
}

/**
 * Repository metadata for a GitHub repository.
 */
export interface GitHubRepoMetadata {
	readonly repo: { owner: string; name: string };
	getRevision(): Promise<{ type: HeadType; name: string; revision: string }>;
}

/**
 * Head type for GitHub repository revision resolution.
 * Uses `as const` object instead of TS enum so the type is structurally compatible
 * across module boundaries without requiring double-casts.
 */
export const HeadType = {
	Branch: 0,
	RemoteBranch: 1,
	Tag: 2,
	Commit: 3,
} as const;
export type HeadType = (typeof HeadType)[keyof typeof HeadType];

/**
 * Simplified authentication session info for the library.
 * The extension bridges from VS Code's `AuthenticationSession` to this.
 */
export interface GitHubSession {
	readonly account: { label: string };
	readonly accessToken: string;
	readonly cloud: boolean;
	readonly type: string | undefined;
	readonly scopes: readonly string[];
	readonly domain: string;
}
