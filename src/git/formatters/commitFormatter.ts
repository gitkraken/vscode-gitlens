'use strict';
import { getPresenceDataUri } from '../../avatars';
import {
	ConnectRemoteProviderCommand,
	DiffWithCommand,
	InviteToLiveShareCommand,
	OpenCommitOnRemoteCommand,
	OpenFileAtRevisionCommand,
	ShowQuickCommitCommand,
	ShowQuickCommitFileCommand,
} from '../../commands';
import { DateStyle, FileAnnotationType } from '../../configuration';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { emojify } from '../../emojis';
import { FormatOptions, Formatter } from './formatter';
import {
	GitCommit,
	GitLogCommit,
	GitRemote,
	GitRevision,
	IssueOrPullRequest,
	PullRequest,
	RemoteProvider,
} from '../git';
import { GitUri } from '../gitUri';
import { Iterables, Promises, Strings } from '../../system';
import { ContactPresence } from '../../vsls/vsls';

const emptyStr = '';

export interface CommitFormatOptions extends FormatOptions {
	autolinkedIssuesOrPullRequests?: Map<string, IssueOrPullRequest | Promises.CancellationError | undefined>;
	dateStyle?: DateStyle;
	footnotes?: Map<number, string>;
	getBranchAndTagTips?: (sha: string) => string | undefined;
	line?: number;
	markdown?: boolean;
	messageAutolinks?: boolean;
	messageIndent?: number;
	messageTruncateAtNewLine?: boolean;
	pullRequestOrRemote?: PullRequest | Promises.CancellationError | GitRemote;
	presence?: ContactPresence;
	previousLineDiffUris?: { current: GitUri; previous: GitUri | undefined };
	remotes?: GitRemote<RemoteProvider>[];

	tokenOptions?: {
		ago?: Strings.TokenOptions;
		agoOrDate?: Strings.TokenOptions;
		agoOrDateShort?: Strings.TokenOptions;
		author?: Strings.TokenOptions;
		authorAgo?: Strings.TokenOptions;
		authorAgoOrDate?: Strings.TokenOptions;
		authorAgoOrDateShort?: Strings.TokenOptions;
		authorDate?: Strings.TokenOptions;
		authorNotYou?: Strings.TokenOptions;
		avatar?: Strings.TokenOptions;
		changes?: Strings.TokenOptions;
		changesShort?: Strings.TokenOptions;
		commands?: Strings.TokenOptions;
		committerAgo?: Strings.TokenOptions;
		committerAgoOrDate?: Strings.TokenOptions;
		committerAgoOrDateShort?: Strings.TokenOptions;
		committerDate?: Strings.TokenOptions;
		date?: Strings.TokenOptions;
		email?: Strings.TokenOptions;
		footnotes?: Strings.TokenOptions;
		id?: Strings.TokenOptions;
		message?: Strings.TokenOptions;
		pullRequest?: Strings.TokenOptions;
		pullRequestAgo?: Strings.TokenOptions;
		pullRequestAgoOrDate?: Strings.TokenOptions;
		pullRequestDate?: Strings.TokenOptions;
		pullRequestState?: Strings.TokenOptions;
		sha?: Strings.TokenOptions;
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

	private get _authorDateAgoShort() {
		return this._item.formatCommitterDateFromNow('en-short');
	}

	private get _committerDate() {
		return this._item.formatCommitterDate(this._options.dateFormat);
	}

	private get _committerDateAgo() {
		return this._item.formatCommitterDateFromNow();
	}

	private get _committerDateAgoShort() {
		return this._item.formatCommitterDateFromNow('en-short');
	}

	private get _date() {
		return this._item.formatDate(this._options.dateFormat);
	}

	private get _dateAgo() {
		return this._item.formatDateFromNow();
	}

	private get _dateAgoShort() {
		return this._item.formatDateFromNow('en-short');
	}

	private get _pullRequestDate() {
		const { pullRequestOrRemote: pr } = this._options;
		if (pr == null || !PullRequest.is(pr)) return emptyStr;

		return pr.formatDate(this._options.dateFormat) ?? emptyStr;
	}

	private get _pullRequestDateAgo() {
		const { pullRequestOrRemote: pr } = this._options;
		if (pr == null || !PullRequest.is(pr)) return emptyStr;

		return pr.formatDateFromNow() ?? emptyStr;
	}

	private get _pullRequestDateOrAgo() {
		const dateStyle = this._options.dateStyle != null ? this._options.dateStyle : Container.config.defaultDateStyle;
		return dateStyle === DateStyle.Absolute ? this._pullRequestDate : this._pullRequestDateAgo;
	}

	get ago(): string {
		return this._padOrTruncate(this._dateAgo, this._options.tokenOptions.ago);
	}

	get agoOrDate(): string {
		const dateStyle = this._options.dateStyle != null ? this._options.dateStyle : Container.config.defaultDateStyle;
		return this._padOrTruncate(
			dateStyle === DateStyle.Absolute ? this._date : this._dateAgo,
			this._options.tokenOptions.agoOrDate,
		);
	}

	get agoOrDateShort(): string {
		const dateStyle = this._options.dateStyle != null ? this._options.dateStyle : Container.config.defaultDateStyle;
		return this._padOrTruncate(
			dateStyle === DateStyle.Absolute ? this._date : this._dateAgoShort,
			this._options.tokenOptions.agoOrDateShort,
		);
	}

	get author(): string {
		const author = this._padOrTruncate(this._item.author, this._options.tokenOptions.author);
		if (!this._options.markdown) {
			return author;
		}

		return `[${author}](mailto:${this._item.email} "Email ${this._item.author} (${this._item.email})")`;
	}

	get authorAgo(): string {
		return this._padOrTruncate(this._authorDateAgo, this._options.tokenOptions.authorAgo);
	}

	get authorAgoOrDate(): string {
		const dateStyle = this._options.dateStyle != null ? this._options.dateStyle : Container.config.defaultDateStyle;
		return this._padOrTruncate(
			dateStyle === DateStyle.Absolute ? this._authorDate : this._authorDateAgo,
			this._options.tokenOptions.authorAgoOrDate,
		);
	}

	get authorAgoOrDateShort(): string {
		const dateStyle = this._options.dateStyle != null ? this._options.dateStyle : Container.config.defaultDateStyle;
		return this._padOrTruncate(
			dateStyle === DateStyle.Absolute ? this._authorDate : this._authorDateAgoShort,
			this._options.tokenOptions.authorAgoOrDateShort,
		);
	}

	get authorDate(): string {
		return this._padOrTruncate(this._authorDate, this._options.tokenOptions.authorDate);
	}

	get authorNotYou(): string {
		if (this._item.author === 'You') return emptyStr;

		const author = this._padOrTruncate(this._item.author, this._options.tokenOptions.authorNotYou);
		if (!this._options.markdown) {
			return author;
		}

		return `[${author}](mailto:${this._item.email} "Email ${this._item.author} (${this._item.email})")`;
	}

	get avatar(): string | Promise<string> {
		if (!this._options.markdown || !Container.config.hovers.avatars) {
			return this._padOrTruncate(emptyStr, this._options.tokenOptions.avatar);
		}

		const presence = this._options.presence;
		if (presence != null) {
			const title = `${this._item.author} ${this._item.author === 'You' ? 'are' : 'is'} ${
				presence.status === 'dnd' ? 'in ' : emptyStr
			}${presence.statusText.toLocaleLowerCase()}`;

			const avatarMarkdownPromise = this._getAvatarMarkdown(title);
			return avatarMarkdownPromise.then(md =>
				this._padOrTruncate(
					`${md}${this._getPresenceMarkdown(presence, title)}`,
					this._options.tokenOptions.avatar,
				),
			);
		}

		return this._getAvatarMarkdown(this._item.author);
	}

	private async _getAvatarMarkdown(title: string) {
		const size = Container.config.hovers.avatarSize;
		const avatarPromise = this._item.getAvatarUri({
			fallback: Container.config.defaultGravatarsStyle,
			size: size,
		});
		return this._padOrTruncate(
			`![${title}](${(await avatarPromise).toString(true)}|width=${size},height=${size} "${title}")`,
			this._options.tokenOptions.avatar,
		);
	}

	private _getPresenceMarkdown(presence: ContactPresence, title: string) {
		return `![${title}](${getPresenceDataUri(presence.status)} "${title}")`;
	}

	get changes(): string {
		return this._padOrTruncate(
			GitLogCommit.is(this._item) ? this._item.getFormattedDiffStatus() : emptyStr,
			this._options.tokenOptions.changes,
		);
	}

	get changesShort(): string {
		return this._padOrTruncate(
			GitLogCommit.is(this._item)
				? this._item.getFormattedDiffStatus({ compact: true, separator: emptyStr })
				: emptyStr,
			this._options.tokenOptions.changesShort,
		);
	}

	get commands(): string {
		if (!this._options.markdown) return this._padOrTruncate(emptyStr, this._options.tokenOptions.commands);

		let commands;
		if (this._item.isUncommitted) {
			const { previousLineDiffUris: diffUris } = this._options;
			if (diffUris?.previous != null) {
				commands = `\`${this._padOrTruncate(
					GitRevision.shorten(
						GitRevision.isUncommittedStaged(diffUris.current.sha)
							? diffUris.current.sha
							: GitRevision.uncommitted,
					)!,
					this._options.tokenOptions.commands,
				)}\``;

				commands += `&nbsp; **[\`${GlyphChars.MuchLessThan}\`](${DiffWithCommand.getMarkdownCommandArgs({
					lhs: {
						sha: diffUris.previous.sha ?? emptyStr,
						uri: diffUris.previous.documentUri(),
					},
					rhs: {
						sha: diffUris.current.sha ?? emptyStr,
						uri: diffUris.current.documentUri(),
					},
					repoPath: this._item.repoPath,
					line: this._options.line,
				})} "Open Changes")** `;
			} else {
				commands = `\`${this._padOrTruncate(
					GitRevision.shorten(
						this._item.isUncommittedStaged ? GitRevision.uncommittedStaged : GitRevision.uncommitted,
					)!,
					this._options.tokenOptions.commands,
				)}\``;
			}

			return commands;
		}

		const separator = ' &nbsp;&nbsp;|&nbsp;&nbsp; ';

		commands = `---\n\n[$(git-commit) ${this.id}](${ShowQuickCommitCommand.getMarkdownCommandArgs(
			this._item.sha,
		)} "Show Commit")${separator}`;

		const { pullRequestOrRemote: pr } = this._options;
		if (pr != null) {
			if (PullRequest.is(pr)) {
				commands += `[$(git-pull-request) PR #${pr.number}](${pr.url} "Open Pull Request \\#${pr.number} on ${
					pr.provider
				}\n${GlyphChars.Dash.repeat(2)}\n${pr.title}\n${pr.state}, ${pr.formatDateFromNow()}")${separator}`;
			} else if (pr instanceof Promises.CancellationError) {
				commands += `[$(git-pull-request) PR (${GlyphChars.Ellipsis})](# "Searching for a Pull Request (if any) that introduced this commit...")${separator}`;
			} else if (pr.provider != null) {
				commands += `[$(plug) Connect to ${pr.provider.name}${
					GlyphChars.Ellipsis
				}](${ConnectRemoteProviderCommand.getMarkdownCommandArgs(pr)} "Connect to ${
					pr.provider.name
				} to enable the display of the Pull Request (if any) that introduced this commit")${separator}`;
			}
		}

		commands += `[$(compare-changes)](${DiffWithCommand.getMarkdownCommandArgs(
			this._item,
			this._options.line,
		)} "Open Changes")${separator}`;

		if (this._item.previousSha != null) {
			const uri = GitUri.toRevisionUri(
				this._item.previousSha,
				this._item.previousUri.fsPath,
				this._item.repoPath,
			);
			commands += `[$(history)](${OpenFileAtRevisionCommand.getMarkdownCommandArgs(
				uri,
				FileAnnotationType.Blame,
				this._options.line,
			)} "Blame Previous Revision")${separator}`;
		}

		if (this._options.remotes != null && this._options.remotes.length !== 0) {
			const providers = GitRemote.getHighlanderProviders(this._options.remotes);

			commands += `[$(globe)](${OpenCommitOnRemoteCommand.getMarkdownCommandArgs(
				this._item.sha,
			)} "Open Commit on ${providers?.length ? providers[0].name : 'Remote'}")${separator}`;
		}

		if (this._item.author !== 'You') {
			const presence = this._options.presence;
			if (presence != null) {
				commands += `[$(live-share)](${InviteToLiveShareCommand.getMarkdownCommandArgs(
					this._item.email,
				)} "Invite ${this._item.author} (${presence.statusText}) to a Live Share Session")${separator}`;
			}
		}

		commands += `[$(ellipsis)](${ShowQuickCommitFileCommand.getMarkdownCommandArgs({
			revisionUri: GitUri.toRevisionUri(this._item.toGitUri()).toString(true),
		})} "Show More Actions")`;

		return this._padOrTruncate(commands, this._options.tokenOptions.commands);
	}

	get committerAgo(): string {
		return this._padOrTruncate(this._committerDateAgo, this._options.tokenOptions.committerAgo);
	}

	get committerAgoOrDate(): string {
		const dateStyle = this._options.dateStyle != null ? this._options.dateStyle : Container.config.defaultDateStyle;
		return this._padOrTruncate(
			dateStyle === DateStyle.Absolute ? this._committerDate : this._committerDateAgo,
			this._options.tokenOptions.committerAgoOrDate,
		);
	}

	get committerAgoOrDateShort(): string {
		const dateStyle = this._options.dateStyle != null ? this._options.dateStyle : Container.config.defaultDateStyle;
		return this._padOrTruncate(
			dateStyle === DateStyle.Absolute ? this._committerDate : this._committerDateAgoShort,
			this._options.tokenOptions.committerAgoOrDateShort,
		);
	}

	get committerDate(): string {
		return this._padOrTruncate(this._committerDate, this._options.tokenOptions.committerDate);
	}

	get date(): string {
		return this._padOrTruncate(this._date, this._options.tokenOptions.date);
	}

	get email(): string {
		return this._padOrTruncate(this._item.email ?? emptyStr, this._options.tokenOptions.email);
	}

	get footnotes(): string {
		return this._padOrTruncate(
			this._options.footnotes == null || this._options.footnotes.size === 0
				? emptyStr
				: Iterables.join(
						Iterables.map(
							this._options.footnotes,
							([i, footnote]) => `${Strings.getSuperscript(i)} ${footnote}`,
						),
						'\n',
				  ),
			this._options.tokenOptions.footnotes,
		);
	}

	get id(): string {
		return this._padOrTruncate(this._item.shortSha ?? emptyStr, this._options.tokenOptions.id);
	}

	get message(): string {
		if (this._item.isUncommitted) {
			const staged =
				this._item.isUncommittedStaged ||
				(this._options.previousLineDiffUris?.current?.isUncommittedStaged ?? false);

			return this._padOrTruncate(
				`${this._options.markdown ? '\n> ' : ''}${staged ? 'Staged' : 'Uncommitted'} changes`,
				this._options.tokenOptions.message,
			);
		}

		let message = this._item.message;
		if (this._options.messageTruncateAtNewLine) {
			const index = message.indexOf('\n');
			if (index !== -1) {
				message = `${message.substring(0, index)}${GlyphChars.Space}${GlyphChars.Ellipsis}`;
			}
		}

		message = emojify(message);
		message = this._padOrTruncate(message, this._options.tokenOptions.message);

		if (this._options.messageAutolinks) {
			message = Container.autolinks.linkify(
				this._options.markdown ? Strings.escapeMarkdown(message, { quoted: true }) : message,
				this._options.markdown ?? false,
				this._options.remotes,
				this._options.autolinkedIssuesOrPullRequests,
				this._options.footnotes,
			);
		}

		if (this._options.messageIndent != null && !this._options.markdown) {
			message = message.replace(/^/gm, GlyphChars.Space.repeat(this._options.messageIndent));
		}

		return this._options.markdown ? `\n> ${message}` : message;
	}

	get pullRequest(): string {
		const { pullRequestOrRemote: pr } = this._options;
		if (pr == null) return this._padOrTruncate(emptyStr, this._options.tokenOptions.pullRequest);

		let text;
		if (PullRequest.is(pr)) {
			if (this._options.markdown) {
				text = `[PR #${pr.number}](${pr.url} "Open Pull Request \\#${pr.number} on ${
					pr.provider
				}\n${GlyphChars.Dash.repeat(2)}\n${pr.title}\n${pr.state}, ${pr.formatDateFromNow()}")`;
			} else if (this._options.footnotes != null) {
				const index = this._options.footnotes.size + 1;
				this._options.footnotes.set(
					index,
					`PR #${pr.number}: ${pr.title}  ${GlyphChars.Dot}  ${pr.state}, ${pr.formatDateFromNow()}`,
				);

				text = `PR #${pr.number}${Strings.getSuperscript(index)}`;
			} else {
				text = `PR #${pr.number}`;
			}
		} else if (pr instanceof Promises.CancellationError) {
			text = this._options.markdown
				? `[PR ${GlyphChars.Ellipsis}](# "Searching for a Pull Request (if any) that introduced this commit...")`
				: `PR ${GlyphChars.Ellipsis}`;
		} else {
			return emptyStr;
		}

		return this._padOrTruncate(text, this._options.tokenOptions.pullRequest);
	}

	get pullRequestAgo(): string {
		return this._padOrTruncate(this._pullRequestDateAgo, this._options.tokenOptions.pullRequestAgo);
	}

	get pullRequestAgoOrDate(): string {
		return this._padOrTruncate(this._pullRequestDateOrAgo, this._options.tokenOptions.pullRequestAgoOrDate);
	}

	get pullRequestDate(): string {
		return this._padOrTruncate(this._pullRequestDate, this._options.tokenOptions.pullRequestDate);
	}

	get pullRequestState(): string {
		const { pullRequestOrRemote: pr } = this._options;
		return this._padOrTruncate(
			pr == null || !PullRequest.is(pr) ? emptyStr : pr.state ?? emptyStr,
			this._options.tokenOptions.pullRequestState,
		);
	}

	get sha(): string {
		return this._padOrTruncate(this._item.shortSha ?? emptyStr, this._options.tokenOptions.sha);
	}

	get tips(): string {
		const branchAndTagTips = this._options.getBranchAndTagTips?.(this._item.sha);
		return this._padOrTruncate(branchAndTagTips ?? emptyStr, this._options.tokenOptions.tips);
	}

	static fromTemplate(template: string, commit: GitCommit, dateFormat: string | null): string;
	static fromTemplate(template: string, commit: GitCommit, options?: CommitFormatOptions): string;
	static fromTemplate(
		template: string,
		commit: GitCommit,
		dateFormatOrOptions?: string | null | CommitFormatOptions,
	): string;
	static fromTemplate(
		template: string,
		commit: GitCommit,
		dateFormatOrOptions?: string | null | CommitFormatOptions,
	): string {
		if (dateFormatOrOptions == null || typeof dateFormatOrOptions === 'string') {
			dateFormatOrOptions = {
				dateFormat: dateFormatOrOptions,
			};
		}

		if (CommitFormatter.has(template, 'footnotes')) {
			if (dateFormatOrOptions.footnotes == null) {
				dateFormatOrOptions.footnotes = new Map<number, string>();
			}
		}

		if (CommitFormatter.has(template, 'avatar') && dateFormatOrOptions?.markdown) {
			// eslint-disable-next-line no-debugger
			debugger;
			throw new Error("Invalid template token 'avatar' used in non-async call");
		}

		return super.fromTemplateCore(this, template, commit, dateFormatOrOptions);
	}

	static fromTemplateAsync(template: string, commit: GitCommit, dateFormat: string | null): Promise<string>;
	static fromTemplateAsync(template: string, commit: GitCommit, options?: CommitFormatOptions): Promise<string>;
	static fromTemplateAsync(
		template: string,
		commit: GitCommit,
		dateFormatOrOptions?: string | null | CommitFormatOptions,
	): Promise<string>;
	static fromTemplateAsync(
		template: string,
		commit: GitCommit,
		dateFormatOrOptions?: string | null | CommitFormatOptions,
	): Promise<string> {
		if (CommitFormatter.has(template, 'footnotes')) {
			if (dateFormatOrOptions == null || typeof dateFormatOrOptions === 'string') {
				dateFormatOrOptions = {
					dateFormat: dateFormatOrOptions,
				};
			}

			if (dateFormatOrOptions.footnotes == null) {
				dateFormatOrOptions.footnotes = new Map<number, string>();
			}
		}

		return super.fromTemplateCoreAsync(this, template, commit, dateFormatOrOptions);
	}

	static has(template: string, ...tokens: (keyof NonNullable<CommitFormatOptions['tokenOptions']>)[]): boolean {
		return super.has<CommitFormatOptions>(template, ...tokens);
	}
}
