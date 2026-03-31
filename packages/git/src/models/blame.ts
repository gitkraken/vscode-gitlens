import type { Event } from '@gitlens/utils/event.js';
import type { GitCommit, GitCommitLine } from './commit.js';

export interface GitBlame {
	readonly repoPath: string;
	readonly authors: Map<string, GitBlameAuthor>;
	readonly commits: Map<string, GitCommit>;
	readonly lines: GitCommitLine[];
}

export interface GitBlameAuthor {
	name: string;
	lineCount: number;
	current?: boolean;
}

export interface GitBlameLine {
	readonly author?: GitBlameAuthor;
	readonly commit: GitCommit;
	readonly line: GitCommitLine;
}

export interface GitBlameProgressEvent {
	readonly blame: GitBlame;
	readonly complete: boolean;
	/** Line indices (0-based) that were resolved since the last progress event */
	readonly newLineIndices: number[];
}

/** Producer-side handle for writing to a progressive blame. Not exposed to consumers. */
export interface ProgressiveGitBlameWriter {
	update(blame: GitBlame, newLineIndices: number[]): void;
	complete(blame: GitBlame): void;
	fail(reason: unknown): void;
}

/**
 * Read-only consumer view of an in-progress blame that grows as `git blame --incremental` streams entries.
 * Exposes the current partial snapshot, a completion promise, and a progress event.
 */
export interface ProgressiveGitBlame {
	readonly current: GitBlame;
	readonly isComplete: boolean;
	readonly completed: Promise<GitBlame>;
	readonly onDidProgress: Event<GitBlameProgressEvent>;
}
