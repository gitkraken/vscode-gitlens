'use strict';
import { Uri } from 'vscode';
import { configuration, DateSource, DateStyle, GravatarDefaultStyle } from '../../configuration';
import { Container } from '../../container';
import { Dates } from '../../system';
import { CommitFormatter } from '../formatters/formatters';
import { Git } from '../git';
import { GitUri } from '../gitUri';
import { getGravatarUri } from '../../gravatar';

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
    dateSource: undefined! as DateSource,
    dateStyle: undefined! as DateStyle,

    reset: () => {
        CommitFormatting.dateFormat = configuration.get<string | null>(configuration.name('defaultDateFormat').value);
        CommitFormatting.dateSource = configuration.get<DateSource>(configuration.name('defaultDateSource').value);
        CommitFormatting.dateStyle = configuration.get<DateStyle>(configuration.name('defaultDateStyle').value);
    }
};

export abstract class GitCommit {
    readonly type: GitCommitType;
    readonly originalFileName: string | undefined;
    previousFileName: string | undefined;

    protected readonly _fileName: string;
    protected _previousSha: string | undefined;

    private _authorDateFormatter: Dates.DateFormatter | undefined;
    private _committerDateFormatter: Dates.DateFormatter | undefined;
    private _isStagedUncommitted: boolean | undefined;
    private _isUncommitted: boolean | undefined;
    private _shortSha: string | undefined;

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
        return CommitFormatting.dateSource === DateSource.Committed ? this.committerDate : this.authorDate;
    }

    get formattedDate(): string {
        return CommitFormatting.dateStyle === DateStyle.Absolute
            ? this.formatDate(CommitFormatting.dateFormat)
            : this.formatDateFromNow();
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

    private _workingUriPromise: Promise<Uri | undefined> | undefined;
    getWorkingUri(): Promise<Uri | undefined> | undefined {
        if (this._workingUriPromise === undefined) {
            this._workingUriPromise = Container.git.getWorkingUri(this.repoPath, this.uri);
        }

        return this._workingUriPromise;
    }

    private get authorDateFormatter(): Dates.DateFormatter {
        if (this._authorDateFormatter === undefined) {
            this._authorDateFormatter = Dates.toFormatter(this.authorDate);
        }
        return this._authorDateFormatter;
    }

    private get committerDateFormatter(): Dates.DateFormatter {
        if (this._committerDateFormatter === undefined) {
            this._committerDateFormatter = Dates.toFormatter(this.committerDate);
        }
        return this._committerDateFormatter;
    }

    private get dateFormatter(): Dates.DateFormatter {
        return CommitFormatting.dateSource === DateSource.Committed
            ? this.committerDateFormatter
            : this.authorDateFormatter;
    }

    formatAuthorDate(format?: string | null) {
        if (format == null) {
            format = 'MMMM Do, YYYY h:mma';
        }

        return this.authorDateFormatter.format(format);
    }

    formatAuthorDateFromNow() {
        return this.authorDateFormatter.fromNow();
    }

    formatCommitterDate(format?: string | null) {
        if (format == null) {
            format = 'MMMM Do, YYYY h:mma';
        }

        return this.committerDateFormatter.format(format);
    }

    formatCommitterDateFromNow() {
        return this.committerDateFormatter.fromNow();
    }

    formatDate(format?: string | null) {
        if (format == null) {
            format = 'MMMM Do, YYYY h:mma';
        }

        return this.dateFormatter.format(format);
    }

    formatDateFromNow() {
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
