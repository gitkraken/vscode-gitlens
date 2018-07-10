'use strict';
import { Strings } from '../../system';
import { GitCommit } from '../models/commit';
import { DateStyle } from '../../configuration';
import { Container } from '../../container';
import { Formatter, IFormatOptions } from './formatter';

export interface ICommitFormatOptions extends IFormatOptions {
    dateStyle?: DateStyle;
    truncateMessageAtNewLine?: boolean;

    tokenOptions?: {
        ago?: Strings.ITokenOptions;
        agoOrDate?: Strings.ITokenOptions;
        author?: Strings.ITokenOptions;
        authorAgo?: Strings.ITokenOptions;
        authorAgoOrDate?: Strings.ITokenOptions;
        date?: Strings.ITokenOptions;
        message?: Strings.ITokenOptions;
    };
}

export class CommitFormatter extends Formatter<GitCommit, ICommitFormatOptions> {
    private get _ago() {
        return this._item.fromNow();
    }

    private get _date() {
        return this._item.formatDate(this._options.dateFormat!);
    }

    private get _agoOrDate() {
        const dateStyle =
            this._options.dateStyle !== undefined ? this._options.dateStyle : Container.config.defaultDateStyle;
        return dateStyle === DateStyle.Absolute ? this._date : this._ago;
    }

    get ago() {
        return this._padOrTruncate(this._ago, this._options.tokenOptions!.ago);
    }

    get agoOrDate() {
        return this._padOrTruncate(this._agoOrDate, this._options.tokenOptions!.agoOrDate);
    }

    get author() {
        const author = this._item.author;
        return this._padOrTruncate(author, this._options.tokenOptions!.author);
    }

    get authorAgo() {
        const authorAgo = `${this._item.author}, ${this._ago}`;
        return this._padOrTruncate(authorAgo, this._options.tokenOptions!.authorAgo);
    }

    get authorAgoOrDate() {
        const authorAgo = `${this._item.author}, ${this._agoOrDate}`;
        return this._padOrTruncate(authorAgo, this._options.tokenOptions!.authorAgo);
    }

    get date() {
        return this._padOrTruncate(this._date, this._options.tokenOptions!.date);
    }

    get id() {
        return this._item.shortSha;
    }

    get message() {
        let message;
        if (this._item.isStagedUncommitted) {
            message = 'Staged changes';
        }
        else if (this._item.isUncommitted) {
            message = 'Uncommitted changes';
        }
        else {
            if (this._options.truncateMessageAtNewLine) {
                message = this._item.getShortMessage();
            }
            else {
                message = this._item.message;
            }
        }

        return this._padOrTruncate(message, this._options.tokenOptions!.message);
    }

    get sha() {
        return this.id;
    }

    static fromTemplate(template: string, commit: GitCommit, dateFormat: string | null): string;
    static fromTemplate(template: string, commit: GitCommit, options?: ICommitFormatOptions): string;
    static fromTemplate(
        template: string,
        commit: GitCommit,
        dateFormatOrOptions?: string | null | ICommitFormatOptions
    ): string;
    static fromTemplate(
        template: string,
        commit: GitCommit,
        dateFormatOrOptions?: string | null | ICommitFormatOptions
    ): string {
        return super.fromTemplateCore(this, template, commit, dateFormatOrOptions);
    }
}
