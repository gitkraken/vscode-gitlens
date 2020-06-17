'use strict';
import { GitDiffParser } from '../parsers/diffParser';

export interface GitDiffLine {
	line: string;
	state: 'added' | 'removed' | 'unchanged';
}

export interface GitDiffHunkLine {
	hunk: GitDiffHunk;
	current: GitDiffLine | undefined;
	previous: GitDiffLine | undefined;
}

export class GitDiffHunk {
	constructor(
		public readonly diff: string,
		public current: {
			count: number;
			position: { start: number; end: number };
		},
		public previous: {
			count: number;
			position: { start: number; end: number };
		},
	) {}

	get lines(): GitDiffHunkLine[] {
		return this.parseHunk().lines;
	}

	get state(): 'added' | 'changed' | 'removed' {
		return this.parseHunk().state;
	}

	private parsedHunk: { lines: GitDiffHunkLine[]; state: 'added' | 'changed' | 'removed' } | undefined;
	private parseHunk() {
		if (this.parsedHunk == null) {
			this.parsedHunk = GitDiffParser.parseHunk(this);
		}
		return this.parsedHunk;
	}
}

export interface GitDiff {
	readonly hunks: GitDiffHunk[];

	readonly diff?: string;
}

export interface GitDiffShortStat {
	readonly files: number;
	readonly insertions: number;
	readonly deletions: number;
}
