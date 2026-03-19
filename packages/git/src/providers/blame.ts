import type { GitBlame, GitBlameLine } from '../models/blame.js';
import type { DiffRange } from './types.js';

export interface GitBlameOptions {
	readonly args?: string[] | null;
	readonly ignoreWhitespace?: boolean;
}

export interface GitBlameSubProvider {
	getBlame(
		repoPath: string,
		path: string,
		rev?: string,
		contents?: string,
		options?: GitBlameOptions,
	): Promise<GitBlame | undefined>;
	getBlameForLine(
		repoPath: string,
		path: string,
		editorLine: number,
		rev?: string,
		contents?: string,
		options?: { forceSingleLine?: boolean } & GitBlameOptions,
	): Promise<GitBlameLine | undefined>;
	getBlameForRange(
		repoPath: string,
		path: string,
		range: DiffRange,
		rev?: string,
		contents?: string,
		options?: GitBlameOptions,
	): Promise<GitBlame | undefined>;
}
