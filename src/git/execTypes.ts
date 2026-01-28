import type { CancellationToken } from 'vscode';
import type { CacheController } from '../system/promiseCache.js';

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
		factory: (cacheable: CacheController) => Promise<GitResult<unknown>>,
		options?: { createTTL?: number; accessTTL?: number },
	): Promise<GitResult<unknown>>;
}

/**
 * Priority levels for git commands.
 * - `interactive`: User-initiated operations (blame, hover) - highest priority
 * - `normal`: Standard operations (status, config) - default priority
 * - `background`: Expensive operations (log, graph) - can be throttled
 */
export type GitCommandPriority = 'interactive' | 'normal' | 'background';

export interface GitExecOptions {
	// extends RunOptions<BufferEncoding | 'buffer' | string> {
	cancellation?: CancellationToken;
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
	readonly env?: Record<string, any>;
	readonly encoding?: BufferEncoding | 'buffer' | string;
	readonly maxBuffer?: number;
	readonly stdin?: string | Buffer;
	readonly stdinEncoding?: string;
	// Set to 0 to disable
	readonly timeout?: number;
}

export interface GitSpawnOptions {
	cancellation?: CancellationToken;
	configs?: readonly string[];

	// Below options comes from SpawnOptions
	cwd?: string;
	readonly env?: Record<string, any>;
	readonly signal?: AbortSignal;
	readonly stdin?: string | Buffer;
	readonly stdinEncoding?: string;
	// Set to 0 to disable
	readonly timeout?: number;
}
