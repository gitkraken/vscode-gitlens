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
    Log = 'log',
    LogFile = 'logFile',
    Stash = 'stash',
    StashFile = 'stashFile'
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
    constructor(
        public readonly type: GitCommitType,
        public readonly repoPath: string,
        public readonly sha: string,
        public readonly author: string,
        public readonly email: string | undefined,
        public readonly authorDate: Date,
        public readonly committerDate: Date,
        public readonly message: string,
        fileName: string,
        public readonly originalFileName: string | undefined,
        public previousSha: string | undefined,
        public previousFileName: string | undefined
    ) {
        this._fileName = fileName || '';
    }

    private readonly _fileName: string;
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

    private _shortSha: string | undefined;
    get shortSha() {
        if (this._shortSha === undefined) {
            this._shortSha = Git.shortenSha(this.sha);
        }
        return this._shortSha;
    }

    get isFile() {
        return (
            this.type === GitCommitType.Blame ||
            this.type === GitCommitType.LogFile ||
            this.type === GitCommitType.StashFile
        );
    }

    get isStash() {
        return this.type === GitCommitType.Stash || this.type === GitCommitType.StashFile;
    }

    private _isStagedUncommitted: boolean | undefined;
    get isStagedUncommitted(): boolean {
        if (this._isStagedUncommitted === undefined) {
            this._isStagedUncommitted = Git.isStagedUncommitted(this.sha);
        }
        return this._isStagedUncommitted;
    }

    private _isUncommitted: boolean | undefined;
    get isUncommitted(): boolean {
        if (this._isUncommitted === undefined) {
            this._isUncommitted = Git.isUncommitted(this.sha);
        }
        return this._isUncommitted;
    }

    get previousFileSha(): string {
        return `${this.sha}^`;
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

    private _authorDateFormatter: Dates.DateFormatter | undefined;
    private get authorDateFormatter(): Dates.DateFormatter {
        if (this._authorDateFormatter === undefined) {
            this._authorDateFormatter = Dates.toFormatter(this.authorDate);
        }
        return this._authorDateFormatter;
    }

    private _committerDateFormatter: Dates.DateFormatter | undefined;
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
