import type { CancellationToken } from 'vscode';

export const enum GitErrorHandling {
	Throw = 0,
	Ignore = 1,
}

export interface GitCommandOptions {
	// extends RunOptions<BufferEncoding | 'buffer' | string> {
	cancellation?: CancellationToken;
	configs?: readonly string[];
	readonly correlationKey?: string;
	errors?: GitErrorHandling;
	// Specifies that this command should always be executed locally if possible
	local?: boolean;

	// Below options comes from RunOptions<BufferEncoding | 'buffer' | string>
	cwd?: string;
	readonly env?: Record<string, any>;
	readonly encoding?: BufferEncoding | 'buffer' | string;
	readonly maxBuffer?: number;
	readonly stdin?: string | Buffer;
	readonly stdinEncoding?: string;
}

export interface GitSpawnOptions {
	cancellation?: CancellationToken;
	configs?: readonly string[];

	// Below options comes from SpawnOptions
	cwd?: string;
	readonly env?: Record<string, any>;
	readonly stdin?: string | Buffer;
	readonly stdinEncoding?: string;
}
