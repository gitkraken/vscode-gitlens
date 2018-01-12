'use strict';
import { GitCommit, GitCommitLine, GitCommitType } from './commit';

export class GitBlameCommit extends GitCommit {

    constructor(
        repoPath: string,
        sha: string,
        author: string,
        email: string | undefined,
        date: Date,
        message: string,
        fileName: string,
        originalFileName: string | undefined,
        previousSha: string | undefined,
        previousFileName: string | undefined,
        public readonly lines: GitCommitLine[]
    ) {
        super(
            GitCommitType.Blame,
            repoPath,
            sha,
            author,
            email,
            date,
            message,
            fileName,
            originalFileName,
            previousSha,
            previousFileName
        );
    }

    get previousFileSha(): string {
        if (this._resolvedPreviousFileSha !== undefined) return this._resolvedPreviousFileSha;

        return `${this.sha}^`;
    }

    with(changes: { sha?: string, fileName?: string, originalFileName?: string | null, previousFileName?: string | null, previousSha?: string | null, lines?: GitCommitLine[] | null }): GitBlameCommit {
        return new GitBlameCommit(
            this.repoPath,
            changes.sha || this.sha,
            this.author,
            this.email,
            this.date,
            this.message,
            changes.fileName || this.fileName,
            this.getChangedValue(changes.originalFileName, this.originalFileName),
            this.getChangedValue(changes.previousSha, this.previousSha),
            this.getChangedValue(changes.previousFileName, this.previousFileName),
            this.getChangedValue(changes.lines, (changes.sha || changes.fileName) ? [] : this.lines) || []
        );
    }
}