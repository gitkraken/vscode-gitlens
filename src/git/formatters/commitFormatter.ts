'use strict';
import {
    DiffWithCommand,
    InviteToLiveShareCommand,
    OpenCommitInRemoteCommand,
    OpenFileRevisionCommand,
    ShowQuickCommitDetailsCommand,
    ShowQuickCommitFileDetailsCommand
} from '../../commands';
import { DateStyle, FileAnnotationType } from '../../configuration';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { GitCommit, GitCommitType, GitLogCommit, GitRemote, GitService, GitUri } from '../gitService';
import { Strings } from '../../system';
import { FormatOptions, Formatter } from './formatter';
import * as emojis from '../../emojis.json';
import { ContactPresence } from '../../vsls/vsls';

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
    presence?: ContactPresence;
    previousLineDiffUris?: { current: GitUri; previous: GitUri | undefined };
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
    private get _authorDate() {
        return this._item.formatAuthorDate(this._options.dateFormat);
    }

    private get _authorDateAgo() {
        return this._item.formatAuthorDateFromNow();
    }

    private get _authorDateOrAgo() {
        const dateStyle =
            this._options.dateStyle !== undefined ? this._options.dateStyle : Container.config.defaultDateStyle;
        return dateStyle === DateStyle.Absolute ? this._authorDate : this._authorDateAgo;
    }

    private get _committerDate() {
        return this._item.formatCommitterDate(this._options.dateFormat);
    }

    private get _committerDateAgo() {
        return this._item.formatCommitterDateFromNow();
    }

    private get _committerDateOrAgo() {
        const dateStyle =
            this._options.dateStyle !== undefined ? this._options.dateStyle : Container.config.defaultDateStyle;
        return dateStyle === DateStyle.Absolute ? this._committerDate : this._committerDateAgo;
    }

    private get _date() {
        return this._item.formatDate(this._options.dateFormat);
    }

    private get _dateAgo() {
        return this._item.formatDateFromNow();
    }

    private get _dateOrAgo() {
        const dateStyle =
            this._options.dateStyle !== undefined ? this._options.dateStyle : Container.config.defaultDateStyle;
        return dateStyle === DateStyle.Absolute ? this._date : this._dateAgo;
    }

    get ago() {
        return this._padOrTruncate(this._dateAgo, this._options.tokenOptions.ago);
    }

    get agoOrDate() {
        return this._padOrTruncate(this._dateOrAgo, this._options.tokenOptions.agoOrDate);
    }

    get author() {
        const author = this._padOrTruncate(this._item.author, this._options.tokenOptions.author);
        if (!this._options.markdown) {
            return author;
        }

        return `[${author}](mailto:${this._item.email} "Email ${this._item.author} (${this._item.email})")`;
    }

    get authorAgo() {
        return this._padOrTruncate(this._authorDateAgo, this._options.tokenOptions.authorAgo);
    }

    get authorAgoOrDate() {
        return this._padOrTruncate(this._authorDateOrAgo, this._options.tokenOptions.authorAgoOrDate);
    }

    get authorDate() {
        return this._padOrTruncate(this._authorDate, this._options.tokenOptions.date);
    }

    get avatar() {
        if (!this._options.markdown || !Container.config.hovers.avatars) {
            return emptyStr;
        }

        let avatar = `![](${this._item.getGravatarUri(Container.config.defaultGravatarsStyle).toString(true)})`;

        const presence = this._options.presence;
        if (presence != null) {
            const title = `${this._item.author} ${this._item.author === 'You' ? 'are' : 'is'} ${
                presence.status === 'dnd' ? 'in ' : ''
            }${presence.statusText.toLocaleLowerCase()}`;

            avatar += `![${title}](${encodeURI(
                `file:///${Container.context.asAbsolutePath(`images/dark/icon-presence-${presence.status}.svg`)}`
            )})`;
            avatar = `[${avatar}](# "${title}")`;
        }

        return avatar;
    }

    get changes() {
        if (!(this._item instanceof GitLogCommit) || this._item.type === GitCommitType.LogFile) {
            return this._padOrTruncate(emptyStr, this._options.tokenOptions.changes);
        }

        return this._padOrTruncate(this._item.getFormattedDiffStatus(), this._options.tokenOptions.changes);
    }

    get changesShort() {
        if (!(this._item instanceof GitLogCommit) || this._item.type === GitCommitType.LogFile) {
            return this._padOrTruncate(emptyStr, this._options.tokenOptions.changesShort);
        }

        return this._padOrTruncate(
            this._item.getFormattedDiffStatus({ compact: true, separator: emptyStr }),
            this._options.tokenOptions.changesShort
        );
    }

    get commands() {
        if (!this._options.markdown) return emptyStr;

        let commands;
        if (this._item.isUncommitted) {
            const { previousLineDiffUris: diffUris } = this._options;
            if (diffUris !== undefined && diffUris.previous !== undefined) {
                commands = `\`${this._padOrTruncate(
                    GitService.shortenSha(
                        GitService.isUncommittedStaged(diffUris.current.sha)
                            ? diffUris.current.sha
                            : GitService.uncommittedSha
                    )!,
                    this._options.tokenOptions.id
                )}\``;

                commands += ` **[\`${GlyphChars.MuchLessThan}\`](${DiffWithCommand.getMarkdownCommandArgs({
                    lhs: {
                        sha: diffUris.previous.sha || '',
                        uri: diffUris.previous.documentUri()
                    },
                    rhs: {
                        sha: diffUris.current.sha || '',
                        uri: diffUris.current.documentUri()
                    },
                    repoPath: this._item.repoPath,
                    line: this._options.line
                })} "Open Changes")** `;
            }
            else {
                commands = `\`${this._padOrTruncate(
                    GitService.shortenSha(
                        this._item.isUncommittedStaged ? GitService.uncommittedStagedSha : GitService.uncommittedSha
                    )!,
                    this._options.tokenOptions.id
                )}\``;
            }

            return commands;
        }

        commands = `[\`${this.id}\`](${ShowQuickCommitDetailsCommand.getMarkdownCommandArgs(
            this._item.sha
        )} "Show Commit Details") `;

        commands += `**[\`${GlyphChars.MuchLessThan}\`](${DiffWithCommand.getMarkdownCommandArgs(
            this._item,
            this._options.line
        )} "Open Changes")** `;

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
            commands += `**[\` ${GlyphChars.EqualsTriple} \`](${OpenFileRevisionCommand.getMarkdownCommandArgs(
                uri,
                annotationType || FileAnnotationType.Blame,
                this._options.line
            )} "Blame Previous Revision")** `;
        }

        if (this._options.remotes !== undefined && this._options.remotes.length !== 0) {
            commands += `**[\` ${GlyphChars.ArrowUpRight} \`](${OpenCommitInRemoteCommand.getMarkdownCommandArgs(
                this._item.sha
            )} "Open in Remote")** `;
        }

        if (this._item.author !== 'You') {
            const presence = this._options.presence;
            if (presence != null) {
                commands += `[\` ${GlyphChars.Envelope}+ \`](${InviteToLiveShareCommand.getMarkdownCommandArgs(
                    this._item.email
                )} "Invite ${this._item.author} (${presence.statusText}) to a Live Share Session") `;
            }
        }

        commands += `[\`${GlyphChars.MiddleEllipsis}\`](${ShowQuickCommitFileDetailsCommand.getMarkdownCommandArgs(
            this._item.sha
        )} "Show More Actions")`;

        return commands;
    }

    get committerAgo() {
        return this._padOrTruncate(this._committerDateAgo, this._options.tokenOptions.ago);
    }

    get committerAgoOrDate() {
        return this._padOrTruncate(this._committerDateOrAgo, this._options.tokenOptions.agoOrDate);
    }

    get committerDate() {
        return this._padOrTruncate(this._committerDate, this._options.tokenOptions.date);
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
        if (this._item.isUncommitted) {
            if (
                this._item.isUncommittedStaged ||
                (this._options.previousLineDiffUris !== undefined &&
                    this._options.previousLineDiffUris.current.isUncommittedStaged)
            ) {
                message = 'Staged changes';
            }
            else {
                message = 'Uncommitted changes';
            }
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
