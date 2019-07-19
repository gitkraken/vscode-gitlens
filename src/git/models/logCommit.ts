'use strict';
import { Uri } from 'vscode';
import { memoize, Strings } from '../../system';
import { GitUri } from '../gitUri';
import { GitCommit, GitCommitType } from './commit';
import { GitFile, GitFileStatus } from './file';

const emptyStats = Object.freeze({
    added: 0,
    deleted: 0,
    changed: 0
});

export interface GitLogCommitLine {
    from: {
        line: number;
        count: number;
    };
    to: {
        line: number;
        count: number;
    };
}

export class GitLogCommit extends GitCommit {
    static is(commit: any): commit is GitLogCommit {
        return (
            commit instanceof GitLogCommit
            // || (commit.repoPath !== undefined &&
            //     commit.sha !== undefined &&
            //     (commit.type === GitCommitType.Log || commit.type === GitCommitType.LogFile))
        );
    }

    nextSha?: string;
    nextFileName?: string;

    constructor(
        type: GitCommitType,
        repoPath: string,
        sha: string,
        author: string,
        email: string | undefined,
        authorDate: Date,
        committerDate: Date,
        message: string,
        fileName: string,
        public readonly files: GitFile[],
        public readonly status?: GitFileStatus | undefined,
        originalFileName?: string | undefined,
        previousSha?: string | undefined,
        previousFileName?: string | undefined,
        private readonly _fileStats?:
            | {
                  insertions: number;
                  deletions: number;
              }
            | undefined,
        public readonly parentShas?: string[],
        public readonly line?: GitLogCommitLine
    ) {
        super(
            type,
            repoPath,
            sha,
            author,
            email,
            authorDate,
            committerDate,
            message,
            fileName,
            originalFileName,
            previousSha || `${sha}^`,
            previousFileName
        );
    }

    get isMerge() {
        return this.parentShas && this.parentShas.length > 1;
    }

    get nextUri(): Uri {
        return this.nextFileName ? GitUri.resolveToUri(this.nextFileName, this.repoPath) : this.uri;
    }

    get previousFileSha(): string {
        return this.isFile ? this.previousSha! : `${this.sha}^`;
    }

    @memoize()
    getDiffStatus() {
        if (this._fileStats !== undefined) {
            return {
                added: this._fileStats.insertions,
                deleted: this._fileStats.deletions,
                changed: 0
            };
        }

        if (this.isFile || this.files.length === 0) return emptyStats;

        const diff = {
            added: 0,
            deleted: 0,
            changed: 0
        };
        for (const f of this.files) {
            switch (f.status) {
                case 'A':
                case '?':
                    diff.added++;
                    break;
                case 'D':
                    diff.deleted++;
                    break;
                default:
                    diff.changed++;
                    break;
            }
        }

        return diff;
    }

    getFormattedDiffStatus({
        compact,
        empty,
        expand,
        prefix = '',
        separator = ' ',
        suffix = ''
    }: {
        compact?: boolean;
        empty?: string;
        expand?: boolean;
        prefix?: string;
        separator?: string;
        suffix?: string;
    } = {}): string {
        const { added, changed, deleted } = this.getDiffStatus();
        if (added === 0 && changed === 0 && deleted === 0) return empty || '';

        if (expand) {
            const type = this.isFile ? 'line' : 'file';

            let status = '';
            if (added) {
                status += `${Strings.pluralize(type, added)} added`;
            }
            if (changed) {
                status += `${status.length === 0 ? '' : separator}${Strings.pluralize(type, changed)} changed`;
            }
            if (deleted) {
                status += `${status.length === 0 ? '' : separator}${Strings.pluralize(type, deleted)} deleted`;
            }
            return `${prefix}${status}${suffix}`;
        }

        // When `isFile` we are getting line changes -- and we can't get changed lines (only inserts and deletes)
        return `${prefix}${compact && added === 0 ? '' : `+${added}${separator}`}${
            (compact || this.isFile) && changed === 0 ? '' : `~${changed}${separator}`
        }${compact && deleted === 0 ? '' : `-${deleted}`}${suffix}`;
    }

    toFileCommit(fileName: string): GitLogCommit | undefined;
    toFileCommit(file: GitFile): GitLogCommit;
    toFileCommit(fileNameOrFile: string | GitFile): GitLogCommit | undefined {
        const fileName =
            typeof fileNameOrFile === 'string'
                ? GitUri.relativeTo(fileNameOrFile, this.repoPath)
                : fileNameOrFile.fileName;
        const file = this.files.find(f => f.fileName === fileName);
        if (file === undefined) return undefined;

        let sha;
        // If this is a stash commit with an untracked file
        if (this.type === GitCommitType.Stash && file.status === '?') {
            sha = `${this.sha}^3`;
        }

        // If this isn't a single-file commit, we can't trust the previousSha
        const previousSha = this.isFile ? this.previousSha : `${this.sha}^`;

        return this.with({
            type: this.isStash ? GitCommitType.StashFile : GitCommitType.LogFile,
            sha: sha,
            fileName: file.fileName,
            originalFileName: file.originalFileName,
            previousSha: previousSha,
            previousFileName: file.originalFileName || file.fileName,
            status: file.status,
            files: [file]
        });
    }

    with(changes: {
        type?: GitCommitType;
        sha?: string | null;
        fileName?: string;
        author?: string;
        email?: string;
        authorDate?: Date;
        committedDate?: Date;
        message?: string;
        originalFileName?: string | null;
        previousFileName?: string | null;
        previousSha?: string | null;
        status?: GitFileStatus;
        files?: GitFile[] | null;
    }): GitLogCommit {
        return new GitLogCommit(
            changes.type || this.type,
            this.repoPath,
            this.getChangedValue(changes.sha, this.sha)!,
            changes.author || this.author,
            changes.email || this.email,
            changes.authorDate || this.authorDate,
            changes.committedDate || this.committerDate,
            changes.message || this.message,
            changes.fileName || this.fileName,
            this.getChangedValue(changes.files, this.files) || [],
            changes.status || this.status,
            this.getChangedValue(changes.originalFileName, this.originalFileName),
            this.getChangedValue(changes.previousSha, this.previousSha),
            this.getChangedValue(changes.previousFileName, this.previousFileName),
            this._fileStats,
            this.parentShas,
            this.line
        );
    }
}
