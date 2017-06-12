'use strict';
import { Strings } from '../../system';
import { GitCommit } from '../models/commit';
import { GitDiffLine } from '../models/diff';
import * as moment from 'moment';

export interface ICommitFormatOptions {
    dateFormat?: string | null;
    tokenOptions?: {
        ago?: Strings.ITokenOptions;
        author?: Strings.ITokenOptions;
        authorAgo?: Strings.ITokenOptions;
        date?: Strings.ITokenOptions;
        message?: Strings.ITokenOptions;
    };
}

export class CommitFormatter {

    private _commit: GitCommit;
    private _options: ICommitFormatOptions;

    constructor(commit: GitCommit, options?: ICommitFormatOptions) {
        this.reset(commit, options);
    }

    reset(commit: GitCommit, options?: ICommitFormatOptions) {
        this._commit = commit;

        if (options === undefined && this._options !== undefined) return;

        options = options || {};
        if (options.tokenOptions == null) {
            options.tokenOptions = {};
        }

        if (options.dateFormat == null) {
            options.dateFormat = 'MMMM Do, YYYY h:MMa';
        }

        this._options = options;
    }

    get ago() {
        const ago = moment(this._commit.date).fromNow();
        return this._padOrTruncate(ago, this._options.tokenOptions!.ago);
    }

    get author() {
        const author = this._commit.author;
        return this._padOrTruncate(author, this._options.tokenOptions!.author);
    }

    get authorAgo() {
        const authorAgo = `${this._commit.author}, ${moment(this._commit.date).fromNow()}`;
        return this._padOrTruncate(authorAgo, this._options.tokenOptions!.authorAgo);
    }

    get date() {
        const date = moment(this._commit.date).format(this._options.dateFormat!);
        return this._padOrTruncate(date, this._options.tokenOptions!.date);
    }

    get id() {
        return this._commit.shortSha;
    }

    get message() {
        const message = this._commit.isUncommitted ? 'Uncommitted change' : this._commit.message;
        return this._padOrTruncate(message, this._options.tokenOptions!.message);
    }

    get sha() {
        return this.id;
    }

    private collapsableWhitespace: number = 0;

    private _padOrTruncate(s: string, options: Strings.ITokenOptions | undefined) {
        // NOTE: the collapsable whitespace logic relies on the javascript template evaluation to be left to right
        if (options === undefined) {
            options = {
                truncateTo: undefined,
                padDirection: 'left',
                collapseWhitespace: false
            };
        }

        let max = options.truncateTo;

        if (max === undefined) {
            if (this.collapsableWhitespace === 0) return s;

            // If we have left over whitespace make sure it gets re-added
            const diff = this.collapsableWhitespace - s.length;
            this.collapsableWhitespace = 0;

            if (diff <= 0) return s;
            if (options.truncateTo === undefined) return s;
            return Strings.padLeft(s, diff);
        }

        max += this.collapsableWhitespace;
        this.collapsableWhitespace = 0;

        const diff = max - s.length;
        if (diff > 0) {
            if (options.collapseWhitespace) {
                this.collapsableWhitespace = diff;
            }

            if (options.padDirection === 'left') return Strings.padLeft(s, max);

            if (options.collapseWhitespace) {
                max -= diff;
            }
            return Strings.padRight(s, max);
        }

        if (diff < 0) return Strings.truncate(s, max);

        return s;
    }

    private static _formatter: CommitFormatter | undefined = undefined;

    static fromCommit(commit: GitCommit, options?: ICommitFormatOptions): CommitFormatter {
        if (CommitFormatter._formatter === undefined) {
            CommitFormatter._formatter = new CommitFormatter(commit, options);
        }
        else {
            CommitFormatter._formatter.reset(commit, options);
        }
        return CommitFormatter._formatter;
    }

    static fromTemplate(template: string, commit: GitCommit, dateFormat: string | null): string;
    static fromTemplate(template: string, commit: GitCommit, options?: ICommitFormatOptions): string;
    static fromTemplate(template: string, commit: GitCommit, dateFormatOrOptions?: string | null | ICommitFormatOptions): string;
    static fromTemplate(template: string, commit: GitCommit, dateFormatOrOptions?: string | null | ICommitFormatOptions): string {
        let options: ICommitFormatOptions | undefined = undefined;
        if (dateFormatOrOptions == null || typeof dateFormatOrOptions === 'string') {
            const tokenOptions = Strings.getTokensFromTemplate(template)
                .reduce((map, token) => {
                    map[token.key] = token.options;
                    return map;
                }, {} as { [token: string]: ICommitFormatOptions });

            options = {
                dateFormat: dateFormatOrOptions,
                tokenOptions: tokenOptions
            };
        }
        else {
            options = dateFormatOrOptions;
        }

        return Strings.interpolate(template, new CommitFormatter(commit, options));
    }

    static toHoverAnnotation(commit: GitCommit, dateFormat: string = 'MMMM Do, YYYY h:MMa'): string | string[] {
        const message = commit.isUncommitted ? '' : `\n\n> ${commit.message.replace(/\n/g, '  \n')}`;
        return `\`${commit.shortSha}\` &nbsp; __${commit.author}__, ${moment(commit.date).fromNow()} &nbsp; _(${moment(commit.date).format(dateFormat)})_${message}`;
    }

    static toHoverDiff(commit: GitCommit, previous: GitDiffLine | undefined, current: GitDiffLine | undefined): string | undefined {
        if (previous === undefined && current === undefined) return undefined;

        const codeDiff = this._getCodeDiff(previous, current);
        return commit.isUncommitted
            ? `\`Changes\` &nbsp; \u2014 &nbsp; _uncommitted_\n${codeDiff}`
            : `\`Changes\` &nbsp; \u2014 &nbsp; \`${commit.previousShortSha}\` \u2194 \`${commit.shortSha}\`\n${codeDiff}`;
    }

    private static _getCodeDiff(previous: GitDiffLine | undefined, current: GitDiffLine | undefined): string {
        return `\`\`\`
-  ${previous === undefined ? '' : previous.line.trim()}
+  ${current === undefined ? '' : current.line.trim()}
\`\`\``;
    }
}