'use strict';
import { Strings } from '../../system';
import { GitCommit } from '../models/commit';
import { Formatter, IFormatOptions } from './formatter';

export interface ICommitFormatOptions extends IFormatOptions {
    truncateMessageAtNewLine?: boolean;

    tokenOptions?: {
        ago?: Strings.ITokenOptions;
        author?: Strings.ITokenOptions;
        authorAgo?: Strings.ITokenOptions;
        date?: Strings.ITokenOptions;
        message?: Strings.ITokenOptions;
    };
}

export class CommitFormatter extends Formatter<GitCommit, ICommitFormatOptions> {

    get ago() {
        const ago = this._item.fromNow();
        return this._padOrTruncate(ago, this._options.tokenOptions!.ago);
    }

    get author() {
        const author = this._item.author;
        return this._padOrTruncate(author, this._options.tokenOptions!.author);
    }

    get authorAgo() {
        const authorAgo = `${this._item.author}, ${this._item.fromNow()}`;
        return this._padOrTruncate(authorAgo, this._options.tokenOptions!.authorAgo);
    }

    get date() {
        const date = this._item.formatDate(this._options.dateFormat!);
        return this._padOrTruncate(date, this._options.tokenOptions!.date);
    }

    get id() {
        if (this._item.isUncommitted && !this._item.isStagedUncommitted) return '00000000';
        return this._item.shortSha;
    }

    get message() {
        let message = this._item.isUncommitted ? 'Uncommitted change' : this._item.message;
        if (this._options.truncateMessageAtNewLine) {
            message = this._item.getShortMessage();
        }

        return this._padOrTruncate(message, this._options.tokenOptions!.message);
    }

    get sha() {
        return this.id;
    }

    static fromTemplate(template: string, commit: GitCommit, dateFormat: string | null): string;
    static fromTemplate(template: string, commit: GitCommit, options?: ICommitFormatOptions): string;
    static fromTemplate(template: string, commit: GitCommit, dateFormatOrOptions?: string | null | ICommitFormatOptions): string;
    static fromTemplate(template: string, commit: GitCommit, dateFormatOrOptions?: string | null | ICommitFormatOptions): string {
        return super.fromTemplateCore(this, template, commit, dateFormatOrOptions);
    }
}