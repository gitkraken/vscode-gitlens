import type { GitFileChange, GitFileChangeShape } from './fileChange';
import type { GitRevisionRangeNotation } from './revision';

export interface GitDiff {
	readonly contents: string;
	readonly from: string;
	readonly to: string;
	readonly notation: GitRevisionRangeNotation | undefined;
}

export interface GitDiffFiles {
	readonly files: GitFileChange[];
}

export interface GitDiffFileStats {
	readonly added: number;
	readonly deleted: number;
	readonly changed: number;
}

export type GitDiffFilter = 'A' | 'C' | 'D' | 'M' | 'R' | 'T' | 'U' | 'X' | 'B' | '*';

export interface GitDiffShortStat {
	readonly files: number;
	readonly additions: number;
	readonly deletions: number;
}

export interface GitLineDiff {
	readonly hunk: ParsedGitDiffHunk;
	readonly line: ParsedGitDiffHunkLine;
}

export interface ParsedGitDiff {
	readonly files: ParsedGitDiffFile[];
	readonly rawContent?: string;
}

export interface ParsedGitDiffFile extends Omit<GitFileChangeShape, 'repoPath'>, ParsedGitDiffHunks {
	readonly header: string;
}

export interface ParsedGitDiffHunks {
	readonly hunks: ParsedGitDiffHunk[];
	readonly rawContent?: string;
}

export interface ParsedGitDiffHunk {
	readonly header: string;
	readonly content: string;

	readonly current: {
		readonly count: number;
		readonly position: { readonly start: number; readonly end: number };
	};
	readonly previous: {
		readonly count: number;
		readonly position: { readonly start: number; readonly end: number };
	};
	readonly lines: Map<number, ParsedGitDiffHunkLine>;
}

export interface ParsedGitDiffHunkLine {
	current: string | undefined;
	previous: string | undefined;
	state: 'added' | 'changed' | 'removed' | 'unchanged';
}
