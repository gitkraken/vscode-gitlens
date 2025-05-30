export interface GitDiff {
	readonly baseSha: string;
	readonly contents: string;
}

export interface GitDiffHunkLine {
	current: string | undefined;
	previous: string | undefined;
	state: 'added' | 'changed' | 'removed' | 'unchanged';
}

export interface GitDiffHunk {
	readonly contents: string;
	readonly current: {
		readonly count: number;
		readonly position: { readonly start: number; readonly end: number };
	};
	readonly previous: {
		readonly count: number;
		readonly position: { readonly start: number; readonly end: number };
	};
	readonly lines: Map<number, GitDiffHunkLine>;
}

export interface GitDiffFile {
	readonly hunks: GitDiffHunk[];
	readonly contents?: string;
}

export interface GitDiffLine {
	readonly hunk: GitDiffHunk;
	readonly line: GitDiffHunkLine;
}

export interface GitDiffShortStat {
	readonly additions: number;
	readonly deletions: number;
	readonly changedFiles: number;
}

export type GitDiffFilter = 'A' | 'C' | 'D' | 'M' | 'R' | 'T' | 'U' | 'X' | 'B' | '*';
