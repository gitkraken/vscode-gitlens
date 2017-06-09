'use strict';

export interface GitDiffLine {
    line: string;
    state: 'added' | 'removed' | 'unchanged';
}

export interface GitDiffChunk {
    current: (GitDiffLine | undefined)[];
    currentStart: number;
    currentEnd: number;

    previous: (GitDiffLine | undefined)[];
    previousStart: number;
    previousEnd: number;

    chunk?: string;
}

export interface GitDiff {
    chunks: GitDiffChunk[];

    diff?: string;
}