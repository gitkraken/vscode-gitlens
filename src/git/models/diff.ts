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
    private _lines: GitDiffHunkLine[] | undefined;

    constructor(
        public readonly diff: string,
        public currentPosition: { start: number; end: number },
        public previousPosition: { start: number; end: number }
    ) {}

    get lines(): GitDiffHunkLine[] {
        if (this._lines === undefined) {
            this._lines = GitDiffParser.parseHunk(this);
        }

        return this._lines;
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
