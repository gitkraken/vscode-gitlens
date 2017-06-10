'use strict';
import { GitDiffParser } from '../parsers/diffParser';

export interface GitDiffLine {
    line: string;
    state: 'added' | 'removed' | 'unchanged';
}

export class GitDiffChunk {

    private _chunk: string | undefined;
    private _current: (GitDiffLine | undefined)[] | undefined;
    private _previous: (GitDiffLine | undefined)[] | undefined;

    constructor(chunk: string, public currentPosition: { start: number, end: number }, public previousPosition: { start: number, end: number }) {
        this._chunk = chunk;
     }

    get current(): (GitDiffLine | undefined)[] {
        if (this._chunk !== undefined) {
            this.parseChunk();
        }

        return this._current!;
    }

    get previous(): (GitDiffLine | undefined)[] {
        if (this._chunk !== undefined) {
            this.parseChunk();
        }

        return this._previous!;
    }

    private parseChunk() {
        [this._current, this._previous] = GitDiffParser.parseChunk(this._chunk!);
        this._chunk = undefined;
    }
}

export interface GitDiff {
    chunks: GitDiffChunk[];

    diff?: string;
}