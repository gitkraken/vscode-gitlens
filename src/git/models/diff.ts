'use strict';

export interface IGitDiffChunk {
    chunk?: string;

    original: (string | undefined)[];
    originalStart: number;
    originalEnd: number;

    changes: (string | undefined)[];
    changesStart: number;
    changesEnd: number;
}

export interface IGitDiff {
    diff?: string;
    chunks: IGitDiffChunk[];
}