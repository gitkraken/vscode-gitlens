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
import { GitCommit, GitLogCommit, GitRemote, GitService, GitUri } from '../gitService';
import { Strings } from '../../system';
import { FormatOptions, Formatter } from './formatter';
import { ContactPresence } from '../../vsls/vsls';
import { getPresenceDataUri } from '../../avatars';
import { emojify } from '../../emojis';

const emptyStr = '';

const hasTokenRegexMap = new Map<string, RegExp>();

export interface CommitFormatOptions extends FormatOptions {
	annotationType?: FileAnnotationType;
	dateStyle?: DateStyle;
	getBranchAndTagTips?: (sha: string) => string | undefined;
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
		authorDate?: Strings.TokenOptions;
		changes?: Strings.TokenOptions;
		changesShort?: Strings.TokenOptions;
		committerAgo?: Strings.TokenOptions;
		committerAgoOrDate?: Strings.TokenOptions;
		committerDate?: Strings.TokenOptions;
		date?: Strings.TokenOptions;
		email?: Strings.TokenOptions;
		id?: Strings.TokenOptions;
		message?: Strings.TokenOptions;
		tips?: Strings.TokenOptions;
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
		return this._padOrTruncate(this._authorDate, this._options.tokenOptions.authorDate);
	}

	get avatar() {
		if (!this._options.markdown || !Container.config.hovers.avatars) {
			return emptyStr;
		}

		let avatar = `![](${this._item
			.getGravatarUri(Container.config.defaultGravatarsStyle)
			.toString(true)}|width=16,height=16)`;

		const presence = this._options.presence;
		if (presence != null) {
			const title = `${this._item.author} ${this._item.author === 'You' ? 'are' : 'is'} ${
				presence.status === 'dnd' ? 'in ' : ''
			}${presence.statusText.toLocaleLowerCase()}`;

			avatar += `![${title}](${getPresenceDataUri(presence.status)})`;
			avatar = `[${avatar}](# "${title}")`;
		}

		return avatar;
	}

	get changes() {
		return this._padOrTruncate(
			GitLogCommit.is(this._item) ? this._item.getFormattedDiffStatus() : emptyStr,
			this._options.tokenOptions.changes
		);
	}

	get changesShort() {
		return this._padOrTruncate(
			GitLogCommit.is(this._item)
				? this._item.getFormattedDiffStatus({ compact: true, separator: emptyStr })
				: emptyStr,
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
			} else {
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
			)} "Open on Remote")** `;
		}

		if (this._item.author !== 'You') {
			const presence = this._options.presence;
			if (presence != null) {
				commands += `[\` ${GlyphChars.Envelope}+ \`](${InviteToLiveShareCommand.getMarkdownCommandArgs(
					this._item.email
				)} "Invite ${this._item.author} (${presence.statusText}) to a Live Share Session") `;
			}
		}

		commands += `[\`${GlyphChars.MiddleEllipsis}\`](${ShowQuickCommitFileDetailsCommand.getMarkdownCommandArgs({
			revisionUri: GitUri.toRevisionUri(this._item.toGitUri()).toString(true)
		})} "Show More Actions")`;

		return commands;
	}

	get committerAgo() {
		return this._padOrTruncate(this._committerDateAgo, this._options.tokenOptions.committerAgo);
	}

	get committerAgoOrDate() {
		return this._padOrTruncate(this._committerDateOrAgo, this._options.tokenOptions.committerAgoOrDate);
	}

	get committerDate() {
		return this._padOrTruncate(this._committerDate, this._options.tokenOptions.committerDate);
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
			} else {
				message = 'Uncommitted changes';
			}
		} else {
			if (this._options.truncateMessageAtNewLine) {
				const index = this._item.message.indexOf('\n');
				message =
					index === -1
						? this._item.message
						: `${this._item.message.substring(0, index)}${GlyphChars.Space}${GlyphChars.Ellipsis}`;
			} else {
				message = this._item.message;
			}

			message = emojify(message);
		}

		message = this._padOrTruncate(message, this._options.tokenOptions.message);

		if (!this._options.markdown) {
			return message;
		}

		message = Container.autolinks.linkify(Strings.escapeMarkdown(message, { quoted: true }), this._options.remotes);

		return `\n> ${message}`;
	}

	get sha() {
		return this.id;
	}

	get tips() {
		const branchAndTagTips = this._options.getBranchAndTagTips && this._options.getBranchAndTagTips(this._item.sha);
		if (branchAndTagTips === undefined) return emptyStr;

		return this._padOrTruncate(branchAndTagTips, this._options.tokenOptions.tips);
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

	static has(format: string, token: string) {
		let regex = hasTokenRegexMap.get(token);
		if (regex === undefined) {
			regex = new RegExp(`\\b${token}\\b`);
			hasTokenRegexMap.set(token, regex);
		}

		return regex.test(format);
	}
}

// const autolinks = new Autolinks();
// const text = autolinks.linkify(`\\#756
// foo
// bar
// baz \\#756
// boo\\#789
// \\#666
// gh\\-89 gh\\-89gh\\-89 GH\\-89`);
// console.log(text);
