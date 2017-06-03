'use strict';

export interface IGitDiffLine {
    line: string;
    state: 'added' | 'removed' | 'unchanged';
}

export interface IGitDiffChunk {
    current: (IGitDiffLine | undefined)[];
    currentStart: number;
    currentEnd: number;

    previous: (IGitDiffLine | undefined)[];
    previousStart: number;
    previousEnd: number;

    chunk?: string;
}

export interface IGitDiff {
    chunks: IGitDiffChunk[];

    diff?: string;
}