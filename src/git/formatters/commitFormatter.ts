'use strict';
import {
    DiffWithCommand,
    OpenCommitInRemoteCommand,
    OpenFileRevisionCommand,
    ShowQuickCommitDetailsCommand,
    ShowQuickCommitFileDetailsCommand
} from '../../commands';
import { DateStyle, FileAnnotationType } from '../../configuration';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { Strings } from '../../system';
import { GitUri } from '../gitUri';
import { GitCommit, GitCommitType } from '../models/commit';
import { GitLogCommit, GitRemote } from '../models/models';
import { FormatOptions, Formatter } from './formatter';
import * as emojis from '../../emojis.json';

const emptyStr = '';
const emojiMap: { [key: string]: string } = emojis;
const emojiRegex = /:([-+_a-z0-9]+):/g;

const escapeMarkdownRegex = /[`>#*_\-+.]/g;
// const sampleMarkdown = '## message `not code` *not important* _no underline_ \n> don\'t quote me \n- don\'t list me \n+ don\'t list me \n1. don\'t list me \nnot h1 \n=== \nnot h2 \n---\n***\n---\n___';
const markdownHeaderReplacement = `${GlyphChars.ZeroWidthSpace}===`;

export interface CommitFormatOptions extends FormatOptions {
    annotationType?: FileAnnotationType;
    dateStyle?: DateStyle;
    line?: number;
    markdown?: boolean;
    remotes?: GitRemote[];
    truncateMessageAtNewLine?: boolean;

    tokenOptions?: {
        ago?: Strings.TokenOptions;
        agoOrDate?: Strings.TokenOptions;
        author?: Strings.TokenOptions;
        authorAgo?: Strings.TokenOptions;
        authorAgoOrDate?: Strings.TokenOptions;
        changes?: Strings.TokenOptions;
        changesShort?: Strings.TokenOptions;
        date?: Strings.TokenOptions;
        email?: Strings.TokenOptions;
        id?: Strings.TokenOptions;
        message?: Strings.TokenOptions;
    };
}

export class CommitFormatter extends Formatter<GitCommit, CommitFormatOptions> {
    private get _ago() {
        return this._item.fromNow();
    }

    private get _date() {
        return this._item.formatDate(this._options.dateFormat);
    }

    private get _agoOrDate() {
        const dateStyle =
            this._options.dateStyle !== undefined ? this._options.dateStyle : Container.config.defaultDateStyle;
        return dateStyle === DateStyle.Absolute ? this._date : this._ago;
    }

    get ago() {
        return this._padOrTruncate(this._ago, this._options.tokenOptions.ago);
    }

    get agoOrDate() {
        return this._padOrTruncate(this._agoOrDate, this._options.tokenOptions.agoOrDate);
    }

    get author() {
        return this._padOrTruncate(this._item.author, this._options.tokenOptions.author);
    }

    get authorAgo() {
        const authorAgo = `${this._item.author}, ${this._ago}`;
        return this._padOrTruncate(authorAgo, this._options.tokenOptions.authorAgo);
    }

    get authorAgoOrDate() {
        const authorAgo = `${this._item.author}, ${this._agoOrDate}`;
        return this._padOrTruncate(authorAgo, this._options.tokenOptions.authorAgoOrDate);
    }

    get avatar() {
        if (!this._options.markdown || !Container.config.hovers.avatars) {
            return emptyStr;
        }

        return `![](${this._item.getGravatarUri(Container.config.defaultGravatarsStyle).toString(true)})`;
    }

    get changes() {
        if (!(this._item instanceof GitLogCommit) || this._item.type === GitCommitType.File) {
            return this._padOrTruncate(emptyStr, this._options.tokenOptions.changes);
        }

        return this._padOrTruncate(this._item.getFormattedDiffStatus(), this._options.tokenOptions.changes);
    }

    get changesShort() {
        if (!(this._item instanceof GitLogCommit) || this._item.type === GitCommitType.File) {
            return this._padOrTruncate(emptyStr, this._options.tokenOptions.changesShort);
        }

        return this._padOrTruncate(
            this._item.getFormattedDiffStatus({ compact: true, separator: emptyStr }),
            this._options.tokenOptions.changesShort
        );
    }

    get commands() {
        if (this._item.isUncommitted) {
            return `\`${
                this._item.shortSha === 'Working Tree'
                    ? this._padOrTruncate('00000000', this._options.tokenOptions.id)
                    : this.id
            }\``;
        }

        let commands = `[\`${this.id}\`](${ShowQuickCommitDetailsCommand.getMarkdownCommandArgs(
            this._item.sha
        )} "Show Commit Details") [\`${GlyphChars.MuchGreaterThan}\`](${DiffWithCommand.getMarkdownCommandArgs(
            this._item
        )} "Open Changes") `;

        if (this._item.previousSha !== undefined) {
            let annotationType = this._options.annotationType;
            if (annotationType === FileAnnotationType.RecentChanges) {
                annotationType = FileAnnotationType.Blame;
            }

            const uri = GitUri.toRevisionUri(
                this._item.previousSha,
                this._item.previousUri.fsPath,
                this._item.repoPath
            );
            commands += `[\`${GlyphChars.SquareWithTopShadow}\`](${OpenFileRevisionCommand.getMarkdownCommandArgs(
                uri,
                annotationType || FileAnnotationType.Blame,
                this._options.line
            )} "Blame Previous Revision") `;
        }

        if (this._options.remotes !== undefined && this._options.remotes.length !== 0) {
            commands += `[\`${GlyphChars.ArrowUpRight}\`](${OpenCommitInRemoteCommand.getMarkdownCommandArgs(
                this._item.sha
            )} "Open in Remote") `;
        }

        commands += `[\`${GlyphChars.MiddleEllipsis}\`](${ShowQuickCommitFileDetailsCommand.getMarkdownCommandArgs(
            this._item.sha
        )} "Show More Actions")`;

        return commands;
    }

    get date() {
        return this._padOrTruncate(this._date, this._options.tokenOptions.date);
    }

    get email() {
        return this._padOrTruncate(this._item.email || emptyStr, this._options.tokenOptions.email);
    }

    get id() {
        return this._padOrTruncate(this._item.shortSha || emptyStr, this._options.tokenOptions.id);
    }

    get message() {
        let message: string;
        if (this._item.isStagedUncommitted) {
            message = 'Staged changes';
        }
        else if (this._item.isUncommitted) {
            message = 'Uncommitted changes';
        }
        else {
            if (this._options.truncateMessageAtNewLine) {
                const index = this._item.message.indexOf('\n');
                message =
                    index === -1
                        ? this._item.message
                        : `${this._item.message.substring(0, index)}${GlyphChars.Space}${GlyphChars.Ellipsis}`;
            }
            else {
                message = this._item.message;
            }

            message = message.replace(emojiRegex, (s, code) => emojiMap[code] || s);
        }

        message = this._padOrTruncate(message, this._options.tokenOptions.message);

        if (!this._options.markdown) {
            return message;
        }

        if (this._options.remotes !== undefined) {
            this._options.remotes.sort(
                (a, b) =>
                    (a.default ? -1 : 1) - (b.default ? -1 : 1) ||
                    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
            );

            for (const r of this._options.remotes) {
                if (r.provider === undefined) continue;

                message = r.provider.enrichMessage(message);
                break;
            }
        }

        return `\n> ${message
            // Escape markdown
            .replace(escapeMarkdownRegex, '\\$&')
            // Escape markdown header (since the above regex won't match it)
            .replace(/^===/gm, markdownHeaderReplacement)
            // Keep under the same block-quote but with line breaks
            .replace(/\n/g, '\t\n>  ')}`;
    }

    get sha() {
        return this.id;
    }

    static fromTemplate(template: string, commit: GitCommit, dateFormat: string | null): string;
    static fromTemplate(template: string, commit: GitCommit, options?: CommitFormatOptions): string;
    static fromTemplate(
        template: string,
        commit: GitCommit,
        dateFormatOrOptions?: string | null | CommitFormatOptions
    ): string;
    static fromTemplate(
        template: string,
        commit: GitCommit,
        dateFormatOrOptions?: string | null | CommitFormatOptions
    ): string {
        return super.fromTemplateCore(this, template, commit, dateFormatOrOptions);
    }
}
