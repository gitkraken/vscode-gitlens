'use strict';
import { Strings } from '../../system';
import { GitCommit } from '../models/commit';
import { Formatter, IFormatOptions } from './formatter';
import * as moment from 'moment';
import { GlyphChars } from '../../constants';

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
        const ago = moment(this._item.date).fromNow();
        return this._padOrTruncate(ago, this._options.tokenOptions!.ago);
    }

    get author() {
        const author = this._item.author;
        return this._padOrTruncate(author, this._options.tokenOptions!.author);
    }

    get authorAgo() {
        const authorAgo = `${this._item.author}, ${moment(this._item.date).fromNow()}`;
        return this._padOrTruncate(authorAgo, this._options.tokenOptions!.authorAgo);
    }

    get date() {
        const date = moment(this._item.date).format(this._options.dateFormat!);
        return this._padOrTruncate(date, this._options.tokenOptions!.date);
    }

    get id() {
        return this._item.shortSha;
    }

    get message() {
        let message = this._item.isUncommitted ? 'Uncommitted change' : this._item.message;
        if (this._options.truncateMessageAtNewLine) {
            const index = message.indexOf('\n');
            if (index !== -1) {
                message = `${message.substring(0, index)}${GlyphChars.Space}${GlyphChars.Ellipsis}`;
            }
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