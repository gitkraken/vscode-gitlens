'use strict';
import { Uri } from 'vscode';
import { configuration, DateStyle, GravatarDefaultStyle } from '../../configuration';
import { Container } from '../../container';
import { Dates } from '../../system';
import { CommitFormatter } from '../formatters/formatters';
import { Git } from '../git';
import { GitUri } from '../gitUri';
import { getGravatarUri } from '../../gravatar';
import { DateType } from '../../config';

export interface GitAuthor {
    name: string;
    lineCount: number;
}

export interface GitCommitLine {
    sha: string;
    previousSha?: string;
    line: number;
    originalLine: number;
    code?: string;
}

export enum GitCommitType {
    Blame = 'blame',
    Branch = 'branch',
    File = 'file',
    Stash = 'stash',
    StashFile = 'stash-file'
}

export const CommitFormatting = {
    dateFormat: undefined! as string | null,
    dateStyle: undefined! as DateStyle,
    dateType: undefined! as DateType,

    reset: () => {
        CommitFormatting.dateStyle = configuration.get<DateStyle>(configuration.name('defaultDateStyle').value);
        CommitFormatting.dateFormat = configuration.get<string | null>(configuration.name('defaultDateFormat').value);
        CommitFormatting.dateType = configuration.get<DateType>(configuration.name('defaultDateType').value);
    }
};

export abstract class GitCommit {
    readonly type: GitCommitType;
    readonly originalFileName: string | undefined;
    previousFileName: string | undefined;
    workingFileName?: string;

    protected readonly _fileName: string;
    protected _previousSha: string | undefined;

    private _isStagedUncommitted: boolean | undefined;
    private _isUncommitted: boolean | undefined;
    private _shortSha: string | undefined;

    private _authorDateFormatter: Dates.DateFormatter | undefined;
    private _committerDateFormatter: Dates.DateFormatter | undefined;

    constructor(
        type: GitCommitType,
        public readonly repoPath: string,
        public readonly sha: string,
        public readonly author: string,
        public readonly email: string | undefined,
        public readonly authorDate: Date,
        public readonly committerDate: Date,
        public readonly message: string,
        fileName: string,
        originalFileName?: string,
        previousSha?: string,
        previousFileName?: string
    ) {
        this.type = type;
        this._fileName = fileName || '';
        this.originalFileName = originalFileName;
        this._previousSha = previousSha;
        this.previousFileName = previousFileName;
    }

    get fileName() {
        // If we aren't a single-file commit, return an empty file name (makes it default to the repoPath)
        return this.isFile ? this._fileName : '';
    }

    get date(): Date {
        return CommitFormatting.dateType === DateType.Committer
            ? this.committerDate : this.authorDate;
    }

    get authorDateFormatter(): Dates.DateFormatter {
        if (this._authorDateFormatter === undefined) {
            this._authorDateFormatter = Dates.toFormatter(this.authorDate);
        }
        return this._authorDateFormatter;
    }

    get committerDateFormatter(): Dates.DateFormatter {
        if (this._committerDateFormatter === undefined) {
            this._committerDateFormatter = Dates.toFormatter(this.committerDate);
        }
        return this._committerDateFormatter;
    }

    get dateFormatter(): Dates.DateFormatter {
        return CommitFormatting.dateType === DateType.Committer
            ? this.committerDateFormatter : this.authorDateFormatter;
    }

    get formattedDate(): string {
        return CommitFormatting.dateStyle === DateStyle.Absolute
            ? this.formatDate(CommitFormatting.dateFormat)
            : this.fromNow();
    }

    get shortSha() {
        if (this._shortSha === undefined) {
            this._shortSha = Git.shortenSha(this.sha);
        }
        return this._shortSha;
    }

    get isFile() {
        return (
            this.type === GitCommitType.Blame ||
            this.type === GitCommitType.File ||
            this.type === GitCommitType.StashFile
        );
    }

    get isStash() {
        return this.type === GitCommitType.Stash || this.type === GitCommitType.StashFile;
    }

    get isStagedUncommitted(): boolean {
        if (this._isStagedUncommitted === undefined) {
            this._isStagedUncommitted = Git.isStagedUncommitted(this.sha);
        }
        return this._isStagedUncommitted;
    }

    get isUncommitted(): boolean {
        if (this._isUncommitted === undefined) {
            this._isUncommitted = Git.isUncommitted(this.sha);
        }
        return this._isUncommitted;
    }

    abstract get previousFileSha(): string;
    protected _resolvedPreviousFileSha: string | undefined;

    get previousFileShortSha(): string {
        return Git.shortenSha(this.previousFileSha)!;
    }

    get previousSha(): string | undefined {
        return this._previousSha;
    }
    set previousSha(value: string | undefined) {
        if (value === this._previousSha) return;

        this._previousSha = value;
        this._resolvedPreviousFileSha = undefined;
    }

    get previousShortSha() {
        return this.previousSha && Git.shortenSha(this.previousSha);
    }

    get previousUri(): Uri {
        return this.previousFileName ? GitUri.resolveToUri(this.previousFileName, this.repoPath) : this.uri;
    }

    get uri(): Uri {
        return GitUri.resolveToUri(this.fileName, this.repoPath);
    }

    get workingUri(): Uri {
        return this.workingFileName ? GitUri.resolveToUri(this.workingFileName, this.repoPath) : this.uri;
    }

    formatDate(format?: string | null) {
        if (format == null) {
            format = 'MMMM Do, YYYY h:mma';
        }

        return this.dateFormatter.format(format);
    }

    fromNow() {
        return this.dateFormatter.fromNow();
    }

    getFormattedPath(options: { relativeTo?: string; separator?: string; suffix?: string } = {}): string {
        return GitUri.getFormattedPath(this.fileName, options);
    }

    getGravatarUri(fallback: GravatarDefaultStyle, size: number = 16): Uri {
        return getGravatarUri(this.email, fallback, size);
    }

    getShortMessage() {
        // eslint-disable-next-line no-template-curly-in-string
        return CommitFormatter.fromTemplate('${message}', this, { truncateMessageAtNewLine: true });
    }

    async resolvePreviousFileSha(): Promise<void> {
        if (this._resolvedPreviousFileSha !== undefined) return;

        this._resolvedPreviousFileSha = await Container.git.resolveReference(
            this.repoPath,
            this.previousFileSha,
            this.fileName ? this.previousUri : undefined
        );
    }

    toGitUri(previous: boolean = false): GitUri {
        return GitUri.fromCommit(this, previous);
    }

    abstract with(changes: {
        type?: GitCommitType;
        sha?: string;
        fileName?: string;
        originalFileName?: string | null;
        previousFileName?: string | null;
        previousSha?: string | null;
    }): GitCommit;

    protected getChangedValue<T>(change: T | null | undefined, original: T | undefined): T | undefined {
        if (change === undefined) return original;
        return change !== null ? change : undefined;
    }
}
