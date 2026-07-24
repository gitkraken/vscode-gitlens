import type { CacheController } from '@gitlens/utils/promiseCache.js';

export type GitErrorHandling = 'throw' | 'ignore';

export type GitResult<T extends string | Buffer | unknown = string> = {
	readonly exitCode: number;
	readonly stdout: T;
	readonly stderr?: T;

	readonly cancelled?: boolean;
};

/**
 * Cache store interface for git command output caching.
 * Stores full GitResult to preserve exitCode/stderr.
 */
export interface GitResultCache {
	getOrCreate(
		repoPath: string,
		key: string,
		// `signal` is the aggregate cancellation — it fires only when every current caller has aborted.
		// Bind shared work to it (not any single caller's signal) so one caller's abort can't reject riders.
		factory: (cacheable: CacheController, signal?: AbortSignal) => Promise<GitResult<unknown>>,
		options?: { createTTL?: number; accessTTL?: number; cancellation?: AbortSignal },
	): Promise<GitResult<unknown>>;
}

/**
 * Priority levels for git commands.
 * - `interactive`: User-initiated operations (blame, hover) - highest priority
 * - `normal`: Standard operations (status, config) - default priority
 * - `background`: Expensive operations (graph rendering, full history walks) - can be throttled
 */
export type GitCommandPriority = 'interactive' | 'normal' | 'background';

export interface GitRunOptions {
	cancellation?: AbortSignal;
	configs?: readonly string[];
	readonly correlationKey?: string;
	errors?: GitErrorHandling;
	/** Priority level for queue ordering. If not specified, will be inferred from the command type. */
	priority?: GitCommandPriority;
	/** Specifies that this command should always be executed locally if possible (for live share sessions) */
	runLocally?: boolean;

	/**
	 * If provided, cache the command's result (stdout, stderr, exitCode) in this store via an auto-generated cache key
	 * Only use for commands with stable output (e.g., `git remote -v`)
	 */
	caching?: {
		cache: GitResultCache;
		/** The common repository path for worktree-shared caching. If not provided, defaults to cwd. */
		commonPath?: string;
		options?: { createTTL?: number; accessTTL?: number };
	};

	// Below options comes from RunOptions<BufferEncoding | 'buffer' | string>
	cwd?: string;
	readonly env?: Record<string, string | undefined>;
	readonly encoding?: BufferEncoding | 'buffer' | string;
	readonly maxBuffer?: number;
	readonly stdin?: string | Buffer;
	readonly stdinEncoding?: string;
	// Set to 0 to disable
	readonly timeout?: number;
}

/**
 * Untyped escape hatch for raw `git <args>` invocation, returned by
 * `GlGitProvider.createUnsafeGit`.
 *
 * "Unsafe" here means **bypasses the typed safety net** the rest of GitLens relies on
 * — sub-provider cancellation/caching/decorator behaviors and signing-awareness do
 * not apply when commands are issued through this object. It does NOT imply command
 * injection risk; the caller still controls the args.
 *
 * Hand instances to libraries that need to issue arbitrary git commands
 * (`@gitkraken/compose-tools`, `@gitkraken/shared-tools` undo). Inside GitLens
 * itself, prefer the typed sub-providers on `RepositoryService` (`branches`,
 * `commits`, `diff`, `staging`, `stash`, `status`, …). Holding an `UnsafeGit`
 * just to call `run(...)` for an ad-hoc command is almost always wrong — the
 * abstraction exists so it can be handed off, not used directly.
 */
export interface UnsafeGit {
	run(args: readonly string[], options?: GitRunOptions): Promise<GitResult>;
}

export interface GitSpawnOptions {
	cancellation?: AbortSignal;
	configs?: readonly string[];

	// Below options comes from SpawnOptions
	cwd?: string;
	readonly env?: Record<string, string | undefined>;
	readonly encoding?: BufferEncoding | 'buffer' | string;
	readonly stdin?: string | Buffer;
	readonly stdinEncoding?: string;
	// Set to 0 to disable
	readonly timeout?: number;
}
