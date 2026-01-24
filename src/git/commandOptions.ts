import type { CancellationToken } from 'vscode';

export const enum GitErrorHandling {
	Throw = 0,
	Ignore = 1,
}

/**
 * Priority levels for git commands.
 * - `interactive`: User-initiated operations (blame, hover) - highest priority
 * - `normal`: Standard operations (status, config) - default priority
 * - `background`: Expensive operations (log, graph) - can be throttled
 */
export type GitCommandPriority = 'interactive' | 'normal' | 'background';

export interface GitCommandOptions {
	// extends RunOptions<BufferEncoding | 'buffer' | string> {
	cancellation?: CancellationToken;
	configs?: readonly string[];
	readonly correlationKey?: string;
	errors?: GitErrorHandling;
	// Specifies that this command should always be executed locally if possible
	local?: boolean;
	/** Priority level for queue ordering. If not specified, will be inferred from the command type. */
	priority?: GitCommandPriority;

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
