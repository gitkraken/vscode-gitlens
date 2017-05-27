'use strict';

export interface IGitDiffChunk {
    current: (string | undefined)[];
    currentStart: number;
    currentEnd: number;

    previous: (string | undefined)[];
    previousStart: number;
    previousEnd: number;

    chunk?: string;
}

export interface IGitDiff {
    chunks: IGitDiffChunk[];

    diff?: string;
}