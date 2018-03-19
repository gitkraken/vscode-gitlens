'use strict';
import { GitBlameCommit, GitLogCommit } from '../gitService';
import { LineTracker } from './lineTracker';

export * from './lineTracker';

export class GitLineState {

    constructor(
        public readonly commit: GitBlameCommit | undefined,
        public logCommit?: GitLogCommit
    ) { }
}

export class GitLineTracker extends LineTracker<GitLineState> {

    private _count = 0;

    start() {
        if (this._disposable !== undefined) {
            this._count = 0;
            return;
        }

        this._count++;
        if (this._count === 1) {
            super.start();
        }
    }

    stop() {
        if (this._disposable !== undefined) {
            this._count = 0;
            return;
        }

        this._count--;
        if (this._count === 0) {
            super.stop();
        }
    }
}
