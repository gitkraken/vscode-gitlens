'use strict';
import { Uri } from 'vscode';
import { configuration, DateSource, DateStyle, GravatarDefaultStyle } from '../../configuration';
import { Container } from '../../container';
import { Dates, memoize } from '../../system';
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

    @memoize()
    get shortSha() {
        return Git.shortenSha(this.sha);
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

    @memoize()
    get isStagedUncommitted(): boolean {
        return Git.isUncommittedStaged(this.sha);
    }

    @memoize()
    get isUncommitted(): boolean {
        return Git.isUncommitted(this.sha);
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

    @memoize()
    get uri(): Uri {
        return GitUri.resolveToUri(this.fileName, this.repoPath);
    }

    // @memoize()
    // getFileStatus() {
    //     if (!this.isFile) return Promise.resolve(undefined);

    //     return Container.git.getStatusForFile(this.repoPath, this.fileName);
    // }

    // @memoize(
    //     (uri: Uri, ref: string | undefined, editorLine?: number) =>
    //         `${uri.toString(true)}|${ref || ''}|${editorLine || ''}`
    // )
    getPreviousDiffUris(uri: Uri, ref: string | undefined, editorLine?: number) {
        if (!this.isFile) return Promise.resolve(undefined);

        return Container.git.getPreviousDiffUris(this.repoPath, uri, ref, 0, editorLine);
    }

    // private _previousUriPromise: Promise<GitUri | undefined> | undefined;
    // getPreviousUri(staged: boolean = false) {
    //     if (!this.isFile) return Promise.resolve(undefined);
    //     if (!this.isUncommitted && this.previousSha !== undefined && !GitService.isShaParent(this.previousSha)) {
    //         return Promise.resolve(this.toGitUri(true));
    //     }

    //     if (this._previousUriPromise === undefined) {
    //         this._previousUriPromise = this._getPreviousUriCore(staged);
    //     }

    //     return this._previousUriPromise;
    // }

    // private async _getPreviousUriCore(staged: boolean) {
    //     if (!staged && !GitService.isStagedUncommitted(this.sha)) {
    //         const status = await this.getFileStatus();
    //         if (status !== undefined) {
    //             // If the file is staged, diff with the staged version
    //             if (status.indexStatus !== undefined) {
    //                 return GitUri.fromFile(this.fileName, this.repoPath, GitService.stagedUncommittedSha);
    //             }
    //         }
    //     }

    //     return Container.git.getPreviousUri(this.repoPath, this.uri, this.sha);
    // }

    @memoize()
    getWorkingUri(): Promise<Uri | undefined> {
        if (!this.isFile) return Promise.resolve(undefined);

        return Container.git.getWorkingUri(this.repoPath, this.uri);
    }

    @memoize()
    private get authorDateFormatter(): Dates.DateFormatter {
        return Dates.getFormatter(this.authorDate);
    }

    @memoize()
    private get committerDateFormatter(): Dates.DateFormatter {
        return Dates.getFormatter(this.committerDate);
    }

    private get dateFormatter(): Dates.DateFormatter {
        return CommitFormatting.dateSource === DateSource.Committed
            ? this.committerDateFormatter
            : this.authorDateFormatter;
    }

    @memoize(format => (format == null ? 'MMMM Do, YYYY h:mma' : format))
    formatAuthorDate(format?: string | null) {
        if (format == null) {
            format = 'MMMM Do, YYYY h:mma';
        }

        return this.authorDateFormatter.format(format);
    }

    formatAuthorDateFromNow() {
        return this.authorDateFormatter.fromNow();
    }

    @memoize(format => (format == null ? 'MMMM Do, YYYY h:mma' : format))
    formatCommitterDate(format?: string | null) {
        if (format == null) {
            format = 'MMMM Do, YYYY h:mma';
        }

        return this.committerDateFormatter.format(format);
    }

    formatCommitterDateFromNow() {
        return this.committerDateFormatter.fromNow();
    }

    @memoize(format => (format == null ? 'MMMM Do, YYYY h:mma' : format))
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

    @memoize()
    getShortMessage() {
        // eslint-disable-next-line no-template-curly-in-string
        return CommitFormatter.fromTemplate('${message}', this, { truncateMessageAtNewLine: true });
    }

    @memoize()
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
