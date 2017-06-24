'use strict';
import { GitDiffParser } from '../parsers/diffParser';

export interface GitDiffLine {
    line: string;
    state: 'added' | 'removed' | 'unchanged';
}

export interface GitDiffChunkLine extends GitDiffLine {
    previous?: (GitDiffLine | undefined)[];
}

export class GitDiffChunk {

    private _chunk: string | undefined;
    private _lines: GitDiffChunkLine[] | undefined;

    constructor(chunk: string, public currentPosition: { start: number, end: number }, public previousPosition: { start: number, end: number }) {
        this._chunk = chunk;
     }

    get lines(): GitDiffChunkLine[] {
        if (this._lines === undefined) {
            this._lines = GitDiffParser.parseChunk(this._chunk!);
            this._chunk = undefined;
        }

        return this._lines;
    }
}

export interface GitDiff {
    chunks: GitDiffChunk[];

    diff?: string;
}