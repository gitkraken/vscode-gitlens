import type { Event } from '@gitlens/utils/event.js';
import type { Uri } from '@gitlens/utils/uri.js';
import type { CachedGitTypes } from './cache.js';
import type { SigningErrorReason } from './errors.js';
import type { GitRemote } from './models/remote.js';
import type { RemoteProvider, RemoteProviderId } from './models/remoteProvider.js';
import type { RepositoryChange } from './models/repository.js';
import type { SearchQuery } from './models/search.js';
import type { SigningFormat } from './models/signature.js';
import type { GitConflictFile } from './models/staging.js';
import type { RemoteProviderConfig } from './remotes/matcher.js';

/**
 * Context provided to sub-providers at construction time.
 * Replaces the Container dependency in the GitLens extension.
 *
 * This is intentionally minimal — most configuration is passed as explicit
 * per-call options on sub-provider methods, not hidden in a context object.
 */
export interface GitServiceContext {
	/**
	 * Provides default values for sub-provider options when callers omit them.
	 * If not provided, sub-providers use their own built-in defaults.
	 */
	readonly config?: GitServiceConfig;
	/** File system abstraction for reading files, checking stats, and listing directories. */
	readonly fs: FileSystemProvider;
	/** Outbound hooks for events from library to host */
	readonly hooks?: GitServiceHooks;
	/** Host-side remote capabilities (custom providers, sorting, repo info) */
	readonly remotes?: RemotesProvider;
	/** Search query preprocessing hooks (e.g., NLP → structured search). */
	readonly searchQuery?: SearchQueryProvider;
	/** Workspace environment (folder resolution, trust state) */
	readonly workspace?: WorkspaceProvider;
}

/**
 * Provides default values for sub-provider options when callers omit them.
 *
 * Consumers implement this backed by their own config system (e.g., VS Code settings).
 * Properties are getters so values are read fresh each time — consumers can make them
 * reactive to config changes.
 *
 * Library sub-providers check `context.config?.{property}` when the caller doesn't
 * pass the corresponding option, falling back to sensible built-in defaults if the
 * config provider is also absent.
 */
export interface GitServiceConfig {
	readonly commits: {
		/** Whether to include file details in commit/stash queries by default. */
		readonly includeFileDetails?: boolean;
		/** Default commit ordering for log/branch queries (e.g., `'date'`, `'author-date'`, `'topo'`). */
		readonly ordering?: 'date' | 'author-date' | 'topo' | null;
		/** Default maximum items for operations (0 = unlimited). */
		readonly maxItems?: number;
		/** Similarity threshold for rename detection (0–100). `null` uses Git's default. */
		readonly similarityThreshold?: number | null;
	};

	/** File-history–specific defaults for `getLogForPath`. */
	readonly fileHistory?: {
		/** Whether to show commits from all branches (maps to `--all`). */
		readonly showAllBranches?: boolean;
		/** Whether to include merge commits (maps to `--no-merges` when false). */
		readonly showMergeCommits?: boolean;
		/** Whether to follow renames (maps to `--follow`). */
		readonly followRenames?: boolean;
	};

	/** Search-specific defaults for `searchCommits`. */
	readonly search?: {
		/** Default maximum items for search results (0 = unlimited). */
		readonly maxItems?: number;
	};

	/** Graph-specific configuration defaults. */
	readonly graph?: {
		/** Graph commit ordering (falls back to `commits.ordering` or `'date'`). */
		readonly commitOrdering?: 'date' | 'author-date' | 'topo';
		/** Whether to only follow first parent in graph. */
		readonly onlyFollowFirstParent?: boolean;
		/** Whether to use avatars in graph. */
		readonly avatars?: boolean;
		/** Maximum search items (0 = unlimited). */
		readonly maxSearchItems?: number;
	};
}

/** Git command types that can produce conflicts. */
export type GitConflictCommand = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'stash-apply' | 'stash-pop';

/**
 * Hooks for outbound events from library to host.
 *
 * All hooks are optional — the library calls them when events occur,
 * and the host decides what to do (telemetry, logging, UI updates, etc.).
 *
 * Provider-augmented hooks (`cache`, `repository`) are wired by the provider
 * to its emitters at construction time. Pass-through hooks (`commits`,
 * `operations`) are provided by the host and forwarded unchanged.
 */
export interface GitServiceHooks {
	/** Cache lifecycle hooks — wired by the provider to its cache-reset emitter */
	readonly cache?: {
		/** Called when cache entries should be cleared */
		onReset?(repoPath: string, ...types: CachedGitTypes[]): void;
	};
	/** Repository state hooks — wired by the provider to its repository-changed emitter */
	readonly repository?: {
		/** Called when repository state has changed */
		onChanged?(repoPath: string, changes: RepositoryChange[]): void;
	};
	/** Commit lifecycle hooks */
	readonly commits?: {
		/**
		 * Called when a commit is signed successfully.
		 *
		 * Note: currently fired only from explicit-sign paths in the patch provider
		 * (where signing is requested via `-S` and confirmed up front). Operations
		 * that sign implicitly via `commit.gpgsign=true` (`commit`, `merge`, `pull`,
		 * `rebase`, `revert`, `cherryPick`) do not fire this hook because the
		 * library cannot cheaply confirm that signing actually occurred without an
		 * extra `git config`/`log --show-signature` call.
		 */
		onSigned?(format: SigningFormat, source?: unknown): void;
		/** Called when commit signing fails — fired from all signing-capable paths. */
		onSigningFailed?(reason: SigningErrorReason, format: SigningFormat, source?: unknown): void;
	};
	/** Git operation hooks */
	readonly operations?: {
		/**
		 * Called when a git command produced a conflict.
		 * @param conflicts Optional conflicted file list. Populated for merge/rebase/cherry-pick/revert;
		 * may be absent for stash operations or when the file list couldn't be read.
		 */
		onConflicted?(command: GitConflictCommand, conflicts?: GitConflictFile[]): void;
		/** Called when getGitDir resolves to a non-existent .git directory or rev-parse fails */
		onGitDirResolveFailed?(repoPath: string, gitDir: string, errorMessage: string): void;
	};
}

/**
 * Host-provided context attached to remote providers at construction time.
 * Subset of {@link RemotesProvider} — only the fields individual providers need.
 */
export interface RemoteProviderContext {
	/** Returns repository info (e.g., ID) from the host's integration system */
	readonly getRepositoryInfo?: (
		providerId: RemoteProviderId,
		target: { owner: string; name: string; project?: string },
	) => Promise<{ id: string } | undefined>;
}

/**
 * File system abstraction following the `workspace.fs` model.
 *
 * Hosts provide an implementation backed by their platform:
 * - Desktop (Node.js): wraps `workspace.fs` or `fs/promises`
 * - Browser: wraps `workspace.fs` for virtual file systems
 *
 * Used by sub-providers that need file system access without
 * importing Node.js `fs` or VS Code APIs directly.
 */
export interface FileStat {
	type: number;
	ctime: number;
	mtime: number;
	size: number;
}

/**
 * File type bitmask matching `vscode.FileType`.
 * Values can be combined (e.g., `FileType.File | FileType.SymbolicLink`).
 */
export const FileType = {
	Unknown: 0,
	File: 1,
	Directory: 2,
	SymbolicLink: 64,
} as const;
export type FileType = (typeof FileType)[keyof typeof FileType];

export interface FileSystemProvider {
	readDirectory(uri: Uri): Promise<[string, number][]>;
	readFile(uri: Uri): Promise<Uint8Array>;
	stat(uri: Uri): Promise<FileStat | undefined>;
}

/**
 * Host-side remote capabilities: custom provider configs, sorting, and repository info.
 *
 * The host provides extra provider configs (user custom remotes, cloud self-managed hosts)
 * and the library combines them with built-in providers to build a matcher.
 * Sorting lets the host control remote priority (integration metadata, user preferences).
 * Repository info enables cross-fork PR URLs via integration API lookups.
 */
export interface RemotesProvider {
	/**
	 * Returns extra remote provider configurations beyond built-ins.
	 * Includes user-configured custom remotes (from settings) and
	 * cloud self-managed host integrations.
	 */
	getCustomProviders?(repoPath: string): Promise<RemoteProviderConfig[] | undefined>;

	/**
	 * Returns repository info from the host's integration system.
	 * Used by remote providers for cross-fork PR creation URLs.
	 * Returns `undefined` if no integration is available or connected.
	 */
	getRepositoryInfo?(
		providerId: RemoteProviderId,
		target: { owner: string; name: string; project?: string },
	): Promise<{ id: string } | undefined>;

	/**
	 * Sorts remotes by priority. The host owns the full ranking policy
	 * (remote name heuristics, integration metadata, user preferences).
	 * If not provided, the library returns remotes in their original order.
	 */
	sort?(remotes: GitRemote<RemoteProvider>[], cancellation?: AbortSignal): Promise<GitRemote<RemoteProvider>[]>;
}

/**
 * Provides search query preprocessing.
 *
 * Hosts implement this to add capabilities like NLP → structured search
 * conversion before the library executes the query.
 */
export interface SearchQueryProvider {
	/**
	 * Pre-processes a search query before execution (e.g., converts natural language to structured search).
	 * Called by commits sub-provider before executing `searchCommits`.
	 */
	preprocessQuery?(search: SearchQuery, source?: unknown): Promise<SearchQuery>;
}

/**
 * Provides workspace environment info: folder resolution and trust state.
 * Used by sub-providers for workspace folder lookup and to gate operations
 * in untrusted workspaces.
 *
 * When `isTrusted` is absent, the workspace is assumed trusted.
 */
export interface WorkspaceProvider {
	/** Fires when the workspace trust state changes (e.g., user grants trust) */
	readonly onDidChangeTrust?: Event<boolean>;

	/** Whether the workspace is currently trusted */
	readonly isTrusted?: boolean;

	/** Resolves the workspace folder that contains the given repoPath */
	getFolder(repoPath: string): { path: string } | undefined;

	/** Returns the default URI for new worktrees, given a repository path. */
	getWorktreeDefaultUri?(repoPath: string): Uri | undefined;
}
