import { parseGitDiffHunk } from '../parsers/diffParser';

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
		public readonly contents: string,
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
			this.parsedHunk = parseGitDiffHunk(this);
		}
		return this.parsedHunk;
	}
}

export interface GitDiff {
	readonly baseSha: string;
	readonly contents: string;
}

export interface GitDiffFile {
	readonly hunks: GitDiffHunk[];
	readonly contents?: string;
}

export interface GitDiffShortStat {
	readonly additions: number;
	readonly deletions: number;
	readonly changedFiles: number;
}

export type GitDiffFilter = 'A' | 'C' | 'D' | 'M' | 'R' | 'T' | 'U' | 'X' | 'B' | '*';
