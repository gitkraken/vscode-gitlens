'use strict';
import * as path from 'path';
import { Uri } from 'vscode';
import { Strings } from '../../system';
import { Git } from '../git';
import { GitCommit, GitCommitType } from './commit';
import { GitFile, GitFileStatus } from './file';

export class GitLogCommit extends GitCommit {
    nextSha?: string;
    nextFileName?: string;

    constructor(
        type: GitCommitType,
        repoPath: string,
        sha: string,
        author: string,
        email: string | undefined,
        date: Date,
        public readonly committedDate: Date,
        message: string,
        fileName: string,
        public readonly files: GitFile[],
        public readonly status: GitFileStatus | undefined,
        originalFileName: string | undefined,
        previousSha: string | undefined,
        previousFileName: string | undefined,
        public readonly parentShas?: string[]
    ) {
        super(
            type,
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

    get isMerge() {
        return this.parentShas && this.parentShas.length > 1;
    }

    get nextShortSha() {
        return this.nextSha && Git.shortenSha(this.nextSha);
    }

    get nextUri(): Uri {
        return this.nextFileName ? Uri.file(path.resolve(this.repoPath, this.nextFileName)) : this.uri;
    }

    get previousFileSha(): string {
        if (this._resolvedPreviousFileSha !== undefined) return this._resolvedPreviousFileSha;

        return this.isFile && this.previousSha ? this.previousSha : `${this.sha}^`;
    }

    private _diff?: {
        added: number;
        deleted: number;
        changed: number;
    };

    getDiffStatus() {
        if (this._diff === undefined) {
            this._diff = {
                added: 0,
                deleted: 0,
                changed: 0
            };

            if (this.files.length !== 0) {
                for (const f of this.files) {
                    switch (f.status) {
                        case 'A':
                        case '?':
                            this._diff.added++;
                            break;
                        case 'D':
                            this._diff.deleted++;
                            break;
                        default:
                            this._diff.changed++;
                            break;
                    }
                }
            }
        }

        return this._diff;
    }

    getFormattedDiffStatus(
        options: {
            compact?: boolean;
            empty?: string;
            expand?: boolean;
            prefix?: string;
            separator?: string;
            suffix?: string;
        } = {}
    ): string {
        const { added, changed, deleted } = this.getDiffStatus();
        if (added === 0 && changed === 0 && deleted === 0) return options.empty || '';

        const { compact, expand, prefix = '', separator = ' ', suffix = '' } = options;
        if (expand) {
            let status = '';
            if (added) {
                status += `${Strings.pluralize('file', added)} added`;
            }
            if (changed) {
                status += `${status === '' ? '' : separator}${Strings.pluralize('file', changed)} changed`;
            }
            if (deleted) {
                status += `${status === '' ? '' : separator}${Strings.pluralize('file', deleted)} deleted`;
            }
            return `${prefix}${status}${suffix}`;
        }

        return `${prefix}${compact && added === 0 ? '' : `+${added}${separator}`}${
            compact && changed === 0 ? '' : `~${changed}${separator}`
        }${compact && deleted === 0 ? '' : `-${deleted}`}${suffix}`;
    }

    toFileCommit(fileName: string): GitLogCommit | undefined;
    toFileCommit(file: GitFile): GitLogCommit;
    toFileCommit(fileNameOrFile: string | GitFile): GitLogCommit | undefined {
        let file: GitFile | undefined;
        if (typeof fileNameOrFile === 'string') {
            const fileName = Strings.normalizePath(path.relative(this.repoPath, fileNameOrFile));
            file = this.files.find(f => f.fileName === fileName);
            if (file === undefined) return undefined;
        }
        else {
            file = fileNameOrFile;
        }

        let sha;
        // If this is a stash commit with an untracked file
        if (this.type === GitCommitType.Stash && file.status === '?') {
            sha = `${this.sha}^3`;
        }

        // If this isn't a single-file commit, we can't trust the previousSha
        const previousSha = this.isFile ? this.previousSha : `${this.sha}^`;

        return this.with({
            type: this.isStash ? GitCommitType.StashFile : GitCommitType.File,
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
        date?: Date;
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
            changes.date || this.date,
            changes.committedDate || this.committedDate,
            changes.message || this.message,
            changes.fileName || this.fileName,
            this.getChangedValue(changes.files, this.files) || [],
            changes.status || this.status,
            this.getChangedValue(changes.originalFileName, this.originalFileName),
            this.getChangedValue(changes.previousSha, this.previousSha),
            this.getChangedValue(changes.previousFileName, this.previousFileName),
            undefined
        );
    }
}
