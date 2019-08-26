'use strict';
import { GitDiffParser } from '../parsers/diffParser';
import { memoize } from '../../system';

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
		public currentPosition: { start: number; end: number },
		public previousPosition: { start: number; end: number }
	) {}

	@memoize()
	get lines(): GitDiffHunkLine[] {
		return GitDiffParser.parseHunk(this);
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
