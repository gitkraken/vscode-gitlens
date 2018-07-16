'use strict';
import * as path from 'path';
import { Uri } from 'vscode';
import { configuration, DateStyle, GravatarDefaultStyle } from '../../configuration';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { Dates, Strings } from '../../system';
import { Git } from '../git';
import { GitUri } from '../gitUri';

const gravatarCache: Map<string, Uri> = new Map();
export function clearGravatarCache() {
    gravatarCache.clear();
}

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

    reset: () => {
        CommitFormatting.dateStyle = configuration.get<DateStyle>(configuration.name('defaultDateStyle').value);
        CommitFormatting.dateFormat = configuration.get<string | null>(configuration.name('defaultDateFormat').value);
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

    constructor(
        type: GitCommitType,
        public readonly repoPath: string,
        public readonly sha: string,
        public readonly author: string,
        public readonly email: string | undefined,
        public readonly date: Date,
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
        return this.previousFileName
            ? Uri.file(path.resolve(this.repoPath, (this.previousFileName || this.originalFileName)!))
            : this.uri;
    }

    get uri(): Uri {
        return Uri.file(path.resolve(this.repoPath, this.fileName));
    }

    private _dateFormatter?: Dates.IDateFormatter;

    formatDate(format?: string | null) {
        if (format == null) {
            format = 'MMMM Do, YYYY h:mma';
        }

        if (this._dateFormatter === undefined) {
            this._dateFormatter = Dates.toFormatter(this.date);
        }
        return this._dateFormatter.format(format);
    }

    fromNow() {
        if (this._dateFormatter === undefined) {
            this._dateFormatter = Dates.toFormatter(this.date);
        }
        return this._dateFormatter.fromNow();
    }

    getFormattedPath(separator: string = Strings.pad(GlyphChars.Dot, 2, 2)): string {
        return GitUri.getFormattedPath(this.fileName, separator);
    }

    getGravatarUri(fallback: GravatarDefaultStyle, size: number = 16): Uri {
        const key = this.email ? `${this.email.trim().toLowerCase()}:${size}` : '';

        let gravatar = gravatarCache.get(key);
        if (gravatar !== undefined) return gravatar;

        gravatar = Uri.parse(
            `https://www.gravatar.com/avatar/${
                this.email ? Strings.md5(this.email, 'hex') : '00000000000000000000000000000000'
            }.jpg?s=${size}&d=${fallback}`
        );

        // HACK: Monkey patch Uri.toString to avoid the unwanted query string encoding
        const originalToStringFn = gravatar.toString;
        gravatar.toString = function(skipEncoding?: boolean | undefined) {
            return originalToStringFn.call(gravatar, true);
        };

        gravatarCache.set(key, gravatar);

        return gravatar;
    }

    getShortMessage(truncationSuffix: string = `${GlyphChars.Space}${GlyphChars.Ellipsis}`) {
        const index = this.message.indexOf('\n');
        if (index === -1) return this.message;

        return `${this.message.substring(0, index)}${truncationSuffix}`;
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
