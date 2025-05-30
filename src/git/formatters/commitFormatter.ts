import type { Uri } from 'vscode';
import type {
	Action,
	ActionContext,
	HoverCommandsActionContext,
	OpenPullRequestActionContext,
} from '../../api/gitlens';
import { getPresenceDataUri } from '../../avatars';
import type { ShowQuickCommitCommandArgs } from '../../commands';
import {
	ConnectRemoteProviderCommand,
	DiffWithCommand,
	OpenCommitOnRemoteCommand,
	OpenFileAtRevisionCommand,
	ShowCommitsInViewCommand,
	ShowQuickCommitFileCommand,
} from '../../commands';
import { Command } from '../../commands/base';
import { DateStyle, FileAnnotationType } from '../../config';
import { Commands, GlyphChars } from '../../constants';
import { Container } from '../../container';
import { emojify } from '../../emojis';
import { arePlusFeaturesEnabled } from '../../plus/subscription/utils';
import type { ShowInCommitGraphCommandArgs } from '../../plus/webviews/graph/protocol';
import { configuration } from '../../system/configuration';
import { join, map } from '../../system/iterable';
import { PromiseCancelledError } from '../../system/promise';
import type { TokenOptions } from '../../system/string';
import { encodeHtmlWeak, escapeMarkdown, getSuperscript } from '../../system/string';
import type { ContactPresence } from '../../vsls/vsls';
import type { PreviousLineComparisonUrisResult } from '../gitProvider';
import type { GitCommit } from '../models/commit';
import { isCommit } from '../models/commit';
import { uncommitted, uncommittedStaged } from '../models/constants';
import type { IssueOrPullRequest } from '../models/issue';
import { PullRequest } from '../models/pullRequest';
import { getReferenceFromRevision, isUncommittedStaged, shortenRevision } from '../models/reference';
import { GitRemote } from '../models/remote';
import type { RemoteProvider } from '../remotes/remoteProvider';
import type { FormatOptions, RequiredTokenOptions } from './formatter';
import { Formatter } from './formatter';

export interface CommitFormatOptions extends FormatOptions {
	autolinkedIssuesOrPullRequests?: Map<string, IssueOrPullRequest | PromiseCancelledError | undefined>;
	avatarSize?: number;
	dateStyle?: DateStyle;
	editor?: { line: number; uri: Uri };
	footnotes?: Map<number, string>;
	getBranchAndTagTips?: (sha: string, options?: { compact?: boolean; icons?: boolean }) => string | undefined;
	htmlFormat?: {
		classes?: {
			author?: string;
			avatar?: string;
			avatarPresence?: string;
			footnote?: string;
			id?: string;
			link?: string;
			message?: string;
			tips?: string;
		};
	};
	messageAutolinks?: boolean;
	messageIndent?: number;
	messageTruncateAtNewLine?: boolean;
	pullRequestOrRemote?: PullRequest | PromiseCancelledError | GitRemote;
	pullRequestPendingMessage?: string;
	presence?: ContactPresence;
	previousLineComparisonUris?: PreviousLineComparisonUrisResult;
	outputFormat?: 'html' | 'markdown' | 'plaintext';
	remotes?: GitRemote<RemoteProvider>[];
	unpublished?: boolean;

	tokenOptions?: {
		ago?: TokenOptions;
		agoOrDate?: TokenOptions;
		agoOrDateShort?: TokenOptions;
		author?: TokenOptions;
		authorAgo?: TokenOptions;
		authorAgoOrDate?: TokenOptions;
		authorAgoOrDateShort?: TokenOptions;
		authorDate?: TokenOptions;
		authorNotYou?: TokenOptions;
		avatar?: TokenOptions;
		changes?: TokenOptions;
		changesDetail?: TokenOptions;
		changesShort?: TokenOptions;
		commands?: TokenOptions;
		committerAgo?: TokenOptions;
		committerAgoOrDate?: TokenOptions;
		committerAgoOrDateShort?: TokenOptions;
		committerDate?: TokenOptions;
		date?: TokenOptions;
		email?: TokenOptions;
		footnotes?: TokenOptions;
		id?: TokenOptions;
		link?: TokenOptions;
		message?: TokenOptions;
		pullRequest?: TokenOptions;
		pullRequestAgo?: TokenOptions;
		pullRequestAgoOrDate?: TokenOptions;
		pullRequestDate?: TokenOptions;
		pullRequestState?: TokenOptions;
		sha?: TokenOptions;
		stashName?: TokenOptions;
		stashNumber?: TokenOptions;
		stashOnRef?: TokenOptions;
		tips?: TokenOptions;
	};
}

export class CommitFormatter extends Formatter<GitCommit, CommitFormatOptions> {
	protected declare _options: RequiredTokenOptions<CommitFormatOptions> &
		Required<Pick<CommitFormatOptions, 'outputFormat'>>;

	override reset(item: GitCommit, options?: CommitFormatOptions) {
		super.reset(item, options);
		if (this._options.outputFormat == null) {
			this._options.outputFormat = 'plaintext';
		}
	}

	private get _authorDate() {
		return this._item.author.formatDate(this._options.dateFormat);
	}

	private get _authorDateAgo() {
		return this._item.author.fromNow();
	}

	private get _authorDateAgoShort() {
		return this._item.author.fromNow(true);
	}

	private get _committerDate() {
		return this._item.committer.formatDate(this._options.dateFormat);
	}

	private get _committerDateAgo() {
		return this._item.committer.fromNow();
	}

	private get _committerDateAgoShort() {
		return this._item.committer.fromNow(true);
	}

	private get _date() {
		return this._item.formatDate(this._options.dateFormat);
	}

	private get _dateAgo() {
		return this._item.formatDateFromNow();
	}

	private get _dateAgoShort() {
		return this._item.formatDateFromNow(true);
	}

	private get _pullRequestDate() {
		const { pullRequestOrRemote: pr } = this._options;
		if (pr == null || !PullRequest.is(pr)) return '';

		return pr.formatDate(this._options.dateFormat) ?? '';
	}

	private get _pullRequestDateAgo() {
		const { pullRequestOrRemote: pr } = this._options;
		if (pr == null || !PullRequest.is(pr)) return '';

		return pr.formatDateFromNow() ?? '';
	}

	private get _pullRequestDateOrAgo() {
		const dateStyle =
			this._options.dateStyle != null ? this._options.dateStyle : configuration.get('defaultDateStyle');
		return dateStyle === DateStyle.Absolute ? this._pullRequestDate : this._pullRequestDateAgo;
	}

	get ago(): string {
		return this._padOrTruncate(this._dateAgo, this._options.tokenOptions.ago);
	}

	get agoOrDate(): string {
		const dateStyle =
			this._options.dateStyle != null ? this._options.dateStyle : configuration.get('defaultDateStyle');
		return this._padOrTruncate(
			dateStyle === DateStyle.Absolute ? this._date : this._dateAgo,
			this._options.tokenOptions.agoOrDate,
		);
	}

	get agoOrDateShort(): string {
		const dateStyle =
			this._options.dateStyle != null ? this._options.dateStyle : configuration.get('defaultDateStyle');
		return this._padOrTruncate(
			dateStyle === DateStyle.Absolute ? this._date : this._dateAgoShort,
			this._options.tokenOptions.agoOrDateShort,
		);
	}

	get author(): string {
		let { name, email } = this._item.author;
		const author = this._padOrTruncate(name, this._options.tokenOptions.author);

		switch (this._options.outputFormat) {
			case 'markdown':
				return `[${author}](${email ? `mailto:${email} "Email ${name} (${email})"` : `# "${name}"`})`;
			case 'html':
				name = encodeHtmlWeak(name);
				email = encodeHtmlWeak(email);
				return /*html*/ `<a ${
					email ? `href="mailto:${email}" title="Email ${name} (${email})"` : `href="#" title="${name}"`
				})${
					this._options.htmlFormat?.classes?.author
						? ` class="${this._options.htmlFormat.classes.author}"`
						: ''
				}>${author}</a>`;
			default:
				return author;
		}
	}

	get authorAgo(): string {
		return this._padOrTruncate(this._authorDateAgo, this._options.tokenOptions.authorAgo);
	}

	get authorAgoOrDate(): string {
		const dateStyle =
			this._options.dateStyle != null ? this._options.dateStyle : configuration.get('defaultDateStyle');
		return this._padOrTruncate(
			dateStyle === DateStyle.Absolute ? this._authorDate : this._authorDateAgo,
			this._options.tokenOptions.authorAgoOrDate,
		);
	}

	get authorAgoOrDateShort(): string {
		const dateStyle =
			this._options.dateStyle != null ? this._options.dateStyle : configuration.get('defaultDateStyle');
		return this._padOrTruncate(
			dateStyle === DateStyle.Absolute ? this._authorDate : this._authorDateAgoShort,
			this._options.tokenOptions.authorAgoOrDateShort,
		);
	}

	get authorDate(): string {
		return this._padOrTruncate(this._authorDate, this._options.tokenOptions.authorDate);
	}

	get authorNotYou(): string {
		let { name, email } = this._item.author;
		if (name === 'You') return this._padOrTruncate('', this._options.tokenOptions.authorNotYou);

		const author = this._padOrTruncate(name, this._options.tokenOptions.authorNotYou);

		switch (this._options.outputFormat) {
			case 'markdown':
				return `[${author}](${email ? `mailto:${email} "Email ${name} (${email})"` : `# "${name}"`})`;
			case 'html':
				name = encodeHtmlWeak(name);
				email = encodeHtmlWeak(email);
				return /*html*/ `<a ${
					email ? `href="mailto:${email}" title="Email ${name} (${email})"` : `href="#" title="${name}"`
				})${
					this._options.htmlFormat?.classes?.author
						? ` class="${this._options.htmlFormat.classes.author}"`
						: ''
				}>${author}</a>`;
			default:
				return author;
		}
	}

	get avatar(): string | Promise<string> {
		const { outputFormat } = this._options;
		if (outputFormat === 'plaintext' || !configuration.get('hovers.avatars')) {
			return this._padOrTruncate('', this._options.tokenOptions.avatar);
		}

		let { name } = this._item.author;

		const presence = this._options.presence;
		if (presence != null) {
			let title = `${name} ${name === 'You' ? 'are' : 'is'} ${
				presence.status === 'dnd' ? 'in ' : ''
			}${presence.statusText.toLocaleLowerCase()}`;

			if (outputFormat === 'html') {
				title = encodeHtmlWeak(title);
			}

			const avatarPromise = this._getAvatar(outputFormat, title, this._options.avatarSize);
			return avatarPromise.then(data =>
				this._padOrTruncate(
					`${data}${this._getPresence(outputFormat, presence, title)}`,
					this._options.tokenOptions.avatar,
				),
			);
		}

		if (outputFormat === 'html') {
			name = encodeHtmlWeak(name);
		}
		return this._getAvatar(outputFormat, name, this._options.avatarSize);
	}

	private async _getAvatar(outputFormat: 'html' | 'markdown', title: string, size?: number) {
		size = size ?? configuration.get('hovers.avatarSize');
		const avatarPromise = this._item.getAvatarUri({
			defaultStyle: configuration.get('defaultGravatarsStyle'),
			size: size,
		});

		const src = (await avatarPromise).toString(true);
		return this._padOrTruncate(
			outputFormat === 'html'
				? /*html*/ `<img src="${src}" alt="title)" title="${title}" width="${size}" height="${size}"${
						this._options.htmlFormat?.classes?.avatar
							? ` class="${this._options.htmlFormat.classes.avatar}"`
							: ''
				  } />`
				: `![${title}](${src}|width=${size},height=${size} "${title}")`,
			this._options.tokenOptions.avatar,
		);
	}

	private _getPresence(outputFormat: 'html' | 'markdown', presence: ContactPresence, title: string) {
		return outputFormat === 'html'
			? /*html*/ `<img src="${getPresenceDataUri(presence.status)}" alt="${title}" title="${title}"${
					this._options.htmlFormat?.classes?.avatarPresence
						? ` class="${this._options.htmlFormat.classes.avatarPresence}"`
						: ''
			  }/>`
			: `![${title}](${getPresenceDataUri(presence.status)} "${title}")`;
	}

	get changes(): string {
		return this._padOrTruncate(
			isCommit(this._item) ? this._item.formatStats() : '',
			this._options.tokenOptions.changes,
		);
	}

	get changesDetail(): string {
		return this._padOrTruncate(
			isCommit(this._item) ? this._item.formatStats({ expand: true, separator: ', ' }) : '',
			this._options.tokenOptions.changesDetail,
		);
	}

	get changesShort(): string {
		return this._padOrTruncate(
			isCommit(this._item) ? this._item.formatStats({ compact: true, separator: '' }) : '',
			this._options.tokenOptions.changesShort,
		);
	}

	get commands(): string {
		// TODO: Implement html rendering
		if (this._options.outputFormat === 'plaintext' || this._options.outputFormat === 'html') {
			return this._padOrTruncate('', this._options.tokenOptions.commands);
		}

		let commands;
		if (this._item.isUncommitted) {
			const { previousLineComparisonUris: diffUris } = this._options;
			if (diffUris?.previous != null) {
				commands = `[\`${this._padOrTruncate(
					shortenRevision(isUncommittedStaged(diffUris.current.sha) ? diffUris.current.sha : uncommitted)!,
					this._options.tokenOptions.commands,
				)}\`](${ShowCommitsInViewCommand.getMarkdownCommandArgs(
					this._item.sha,
					this._item.repoPath,
				)} "Open Details")`;

				commands += ` &nbsp;[$(chevron-left)$(compare-changes)](${DiffWithCommand.getMarkdownCommandArgs({
					lhs: {
						sha: diffUris.previous.sha ?? '',
						uri: diffUris.previous.documentUri(),
					},
					rhs: {
						sha: diffUris.current.sha ?? '',
						uri: diffUris.current.documentUri(),
					},
					repoPath: this._item.repoPath,
					line: this._options.editor?.line,
				})} "Open Changes with Previous Revision")`;

				commands += ` &nbsp;[$(versions)](${OpenFileAtRevisionCommand.getMarkdownCommandArgs(
					Container.instance.git.getRevisionUri(diffUris.previous),
					FileAnnotationType.Blame,
					this._options.editor?.line,
				)} "Open Blame Prior to this Change")`;
			} else {
				commands = `[\`${this._padOrTruncate(
					shortenRevision(this._item.isUncommittedStaged ? uncommittedStaged : uncommitted)!,
					this._options.tokenOptions.commands,
				)}\`](${ShowCommitsInViewCommand.getMarkdownCommandArgs(
					this._item.sha,
					this._item.repoPath,
				)} "Open Details")`;
			}

			return commands;
		}

		const separator = ' &nbsp;&nbsp;|&nbsp;&nbsp; ';

		commands = `---\n\n[\`$(git-commit) ${this.id}\`](${ShowCommitsInViewCommand.getMarkdownCommandArgs(
			this._item.sha,
			this._item.repoPath,
		)} "Open Details")`;

		commands += ` &nbsp;[$(chevron-left)$(compare-changes)](${DiffWithCommand.getMarkdownCommandArgs(
			this._item,
			this._options.editor?.line,
		)} "Open Changes with Previous Revision")`;

		if (this._item.file != null && this._item.unresolvedPreviousSha != null) {
			const uri = Container.instance.git.getRevisionUri(
				this._item.unresolvedPreviousSha,
				this._item.file.originalPath ?? this._item.file?.path,
				this._item.repoPath,
			);
			commands += ` &nbsp;[$(versions)](${OpenFileAtRevisionCommand.getMarkdownCommandArgs(
				uri,
				FileAnnotationType.Blame,
				this._options.editor?.line,
			)} "Open Blame Prior to this Change")`;
		}

		commands += ` &nbsp;[$(search)](${Command.getMarkdownCommandArgsCore<ShowQuickCommitCommandArgs>(
			Commands.RevealCommitInView,
			{
				repoPath: this._item.repoPath,
				sha: this._item.sha,
				revealInView: true,
			},
		)} "Reveal in Side Bar")`;

		if (arePlusFeaturesEnabled()) {
			commands += ` &nbsp;[$(gitlens-graph)](${Command.getMarkdownCommandArgsCore<ShowInCommitGraphCommandArgs>(
				Commands.ShowInCommitGraph,
				{ ref: getReferenceFromRevision(this._item) },
			)} "Open in Commit Graph")`;
		}

		if (this._options.remotes != null && this._options.remotes.length !== 0) {
			const providers = GitRemote.getHighlanderProviders(this._options.remotes);

			commands += ` &nbsp;[$(globe)](${OpenCommitOnRemoteCommand.getMarkdownCommandArgs(
				this._item.sha,
			)} "Open Commit on ${providers?.length ? providers[0].name : 'Remote'}")`;
		}

		const { pullRequestOrRemote: pr } = this._options;
		if (pr != null) {
			if (PullRequest.is(pr)) {
				commands += `${separator}[$(git-pull-request) PR #${
					pr.id
				}](${getMarkdownActionCommand<OpenPullRequestActionContext>('openPullRequest', {
					repoPath: this._item.repoPath,
					provider: { id: pr.provider.id, name: pr.provider.name, domain: pr.provider.domain },
					pullRequest: { id: pr.id, url: pr.url },
				})} "Open Pull Request \\#${pr.id}${
					Container.instance.actionRunners.count('openPullRequest') == 1 ? ` on ${pr.provider.name}` : '...'
				}\n${GlyphChars.Dash.repeat(2)}\n${escapeMarkdown(pr.title).replace(/"/g, '\\"')}\n${
					pr.state
				}, ${pr.formatDateFromNow()}")`;
			} else if (pr instanceof PromiseCancelledError) {
				commands += `${separator}[$(git-pull-request) PR $(loading~spin)](command:${Commands.RefreshHover} "Searching for a Pull Request (if any) that introduced this commit...")`;
			} else if (pr.provider != null && configuration.get('integrations.enabled')) {
				commands += `${separator}[$(plug) Connect to ${pr.provider.name}${
					GlyphChars.Ellipsis
				}](${ConnectRemoteProviderCommand.getMarkdownCommandArgs(pr)} "Connect to ${
					pr.provider.name
				} to enable the display of the Pull Request (if any) that introduced this commit")`;
			}
		}

		if (Container.instance.actionRunners.count('hover.commands') > 0) {
			const { name, email } = this._item.author;

			commands += `${separator}[$(organization) Team${GlyphChars.SpaceThinnest}${
				GlyphChars.Ellipsis
			}](${getMarkdownActionCommand<HoverCommandsActionContext>('hover.commands', {
				repoPath: this._item.repoPath,
				commit: {
					sha: this._item.sha,
					author: {
						name: name,
						email: email,
						presence: this._options.presence,
					},
				},
				file:
					this._options.editor != null
						? {
								uri: this._options.editor?.uri.toString(),
								line: this._options.editor?.line,
						  }
						: undefined,
			})} "Show Team Actions")`;
		}

		const gitUri = this._item.getGitUri();
		commands += `${separator}[$(ellipsis)](${ShowQuickCommitFileCommand.getMarkdownCommandArgs(
			gitUri != null
				? {
						revisionUri: Container.instance.git.getRevisionUri(gitUri).toString(true),
				  }
				: { commit: this._item },
		)} "Show More Actions")`;

		return this._padOrTruncate(commands, this._options.tokenOptions.commands);
	}

	get committerAgo(): string {
		return this._padOrTruncate(this._committerDateAgo, this._options.tokenOptions.committerAgo);
	}

	get committerAgoOrDate(): string {
		const dateStyle =
			this._options.dateStyle != null ? this._options.dateStyle : configuration.get('defaultDateStyle');
		return this._padOrTruncate(
			dateStyle === DateStyle.Absolute ? this._committerDate : this._committerDateAgo,
			this._options.tokenOptions.committerAgoOrDate,
		);
	}

	get committerAgoOrDateShort(): string {
		const dateStyle =
			this._options.dateStyle != null ? this._options.dateStyle : configuration.get('defaultDateStyle');
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
		const { email } = this._item.author;
		return this._padOrTruncate(email ?? '', this._options.tokenOptions.email);
	}

	get footnotes(): string {
		const { outputFormat } = this._options;
		return this._padOrTruncate(
			this._options.footnotes == null || this._options.footnotes.size === 0
				? ''
				: join(
						map(this._options.footnotes, ([i, footnote]) =>
							outputFormat === 'plaintext' ? `${getSuperscript(i)} ${footnote}` : footnote,
						),
						outputFormat === 'html' ? /*html*/ `<br \\>` : outputFormat === 'markdown' ? '\\\n' : '\n',
				  ),
			this._options.tokenOptions.footnotes,
		);
	}

	get id(): string {
		const sha = this._padOrTruncate(this._item.shortSha ?? '', this._options.tokenOptions.id);
		if (this._options.outputFormat !== 'plaintext' && this._options.unpublished) {
			return /*html*/ `<span style="color:#35b15e;"${
				this._options.htmlFormat?.classes?.id ? ` class="${this._options.htmlFormat.classes.id}"` : ''
			}>${sha} (unpublished)</span>`;
		}

		return sha;
	}

	get link(): string {
		let link;
		switch (this._options.outputFormat) {
			case 'markdown': {
				const sha = this._padOrTruncate(this._item.shortSha ?? '', this._options.tokenOptions.id);
				link = `[\`$(git-commit) ${sha}\`](${ShowCommitsInViewCommand.getMarkdownCommandArgs(
					this._item.sha,
					this._item.repoPath,
				)} "Open Details")`;
				break;
			}
			case 'html': {
				const sha = this._padOrTruncate(this._item.shortSha ?? '', this._options.tokenOptions.id);
				link = /*html*/ `<a href="${ShowCommitsInViewCommand.getMarkdownCommandArgs(
					this._item.sha,
					this._item.repoPath,
				)}" title="Open Details"${
					this._options.htmlFormat?.classes?.link ? ` class="${this._options.htmlFormat.classes.link}"` : ''
				}><span class="codicon codicon-git-commit"></span>${sha}</a>`;
				break;
			}
			default:
				return this.id;
		}

		return this._padOrTruncate(link, this._options.tokenOptions.link);
	}

	get message(): string {
		const { outputFormat } = this._options;

		if (this._item.isUncommitted) {
			const conflicted = this._item.file?.hasConflicts ?? false;
			const staged =
				this._item.isUncommittedStaged ||
				(this._options.previousLineComparisonUris?.current?.isUncommittedStaged ?? false);

			let message = `${conflicted ? 'Merge' : staged ? 'Staged' : 'Uncommitted'} changes`;
			switch (outputFormat) {
				case 'html':
					message = /*html*/ `<span ${
						this._options.htmlFormat?.classes?.message
							? `class="${this._options.htmlFormat.classes.message}"`
							: ''
					}>${message}</span>`;
					break;
				case 'markdown':
					message = `\n> ${message}`;
					break;
			}
			return this._padOrTruncate(message, this._options.tokenOptions.message);
		}

		let message = (
			this._options.messageTruncateAtNewLine ? this._item.summary : this._item.message ?? this._item.summary
		)
			.trim()
			.replace(/\r?\n/g, '\n');

		message = emojify(message);
		message = this._padOrTruncate(message, this._options.tokenOptions.message);

		if (outputFormat !== 'plaintext') {
			message = encodeHtmlWeak(message);
		}
		if (outputFormat === 'markdown') {
			message = escapeMarkdown(message, { quoted: true });
		}

		if (this._options.messageAutolinks) {
			message = Container.instance.autolinks.linkify(
				message,
				outputFormat,
				this._options.remotes,
				this._options.autolinkedIssuesOrPullRequests,
				this._options.footnotes,
			);
		}

		if (this._options.messageIndent != null && outputFormat === 'plaintext') {
			message = message.replace(/^/gm, GlyphChars.Space.repeat(this._options.messageIndent));
		}

		switch (outputFormat) {
			case 'html':
				return /*html*/ `<span ${
					this._options.htmlFormat?.classes?.id ? `class="${this._options.htmlFormat.classes.id}"` : ''
				}>${message}</span>`;
			case 'markdown':
				return `\n> ${message}`;
			default:
				return message;
		}
	}

	get pullRequest(): string {
		const { pullRequestOrRemote: pr } = this._options;
		// TODO: Implement html rendering
		if (pr == null || this._options.outputFormat === 'html') {
			return this._padOrTruncate('', this._options.tokenOptions.pullRequest);
		}

		let text;
		if (PullRequest.is(pr)) {
			if (this._options.outputFormat === 'markdown') {
				const prTitle = escapeMarkdown(pr.title).replace(/"/g, '\\"').trim();

				text = `PR [**#${pr.id}**](${getMarkdownActionCommand<OpenPullRequestActionContext>('openPullRequest', {
					repoPath: this._item.repoPath,
					provider: { id: pr.provider.id, name: pr.provider.name, domain: pr.provider.domain },
					pullRequest: { id: pr.id, url: pr.url },
				})} "Open Pull Request \\#${pr.id}${
					Container.instance.actionRunners.count('openPullRequest') == 1 ? ` on ${pr.provider.name}` : '...'
				}\n${GlyphChars.Dash.repeat(2)}\n${escapeMarkdown(pr.title).replace(/"/g, '\\"')}\n${
					pr.state
				}, ${pr.formatDateFromNow()}")`;

				if (this._options.footnotes != null) {
					const index = this._options.footnotes.size + 1;
					this._options.footnotes.set(
						index,
						`${PullRequest.getMarkdownIcon(pr)} [**${prTitle}**](${pr.url} "Open Pull Request \\#${
							pr.id
						} on ${pr.provider.name}")\\\n${GlyphChars.Space.repeat(4)} #${
							pr.id
						} ${pr.state.toLocaleLowerCase()} ${pr.formatDateFromNow()}`,
					);
				}
			} else if (this._options.footnotes != null) {
				const index = this._options.footnotes.size + 1;
				this._options.footnotes.set(
					index,
					`PR #${pr.id}: ${pr.title}  ${GlyphChars.Dot}  ${pr.state}, ${pr.formatDateFromNow()}`,
				);

				text = `PR #${pr.id}${getSuperscript(index)}`;
			} else {
				text = `PR #${pr.id}`;
			}
		} else if (pr instanceof PromiseCancelledError) {
			text =
				this._options.outputFormat === 'markdown'
					? `[PR $(loading~spin)](command:${Commands.RefreshHover} "Searching for a Pull Request (if any) that introduced this commit...")`
					: this._options?.pullRequestPendingMessage ?? '';
		} else {
			return this._padOrTruncate('', this._options.tokenOptions.pullRequest);
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
			pr == null || !PullRequest.is(pr) ? '' : pr.state ?? '',
			this._options.tokenOptions.pullRequestState,
		);
	}

	get sha(): string {
		return this._padOrTruncate(this._item.shortSha ?? '', this._options.tokenOptions.sha);
	}

	get stashName(): string {
		return this._padOrTruncate(this._item.stashName ?? '', this._options.tokenOptions.stashName);
	}

	get stashNumber(): string {
		return this._padOrTruncate(this._item.number ?? '', this._options.tokenOptions.stashNumber);
	}

	get stashOnRef(): string {
		return this._padOrTruncate(this._item.stashOnRef ?? '', this._options.tokenOptions.stashOnRef);
	}

	get tips(): string {
		let branchAndTagTips = this._options.getBranchAndTagTips?.(this._item.sha, {
			icons: this._options.outputFormat === 'markdown',
		});
		if (branchAndTagTips != null && this._options.outputFormat !== 'plaintext') {
			const tips = branchAndTagTips.split(', ');
			branchAndTagTips = tips
				.map(
					t =>
						/*html*/ `<span style="color:#ffffff;background-color:#1d76db;"${
							this._options.htmlFormat?.classes?.tips
								? ` class="${this._options.htmlFormat.classes.tips}"`
								: ''
						}>&nbsp;&nbsp;${t}&nbsp;&nbsp;</span>`,
				)
				.join(GlyphChars.Space.repeat(3));
		}
		return this._padOrTruncate(branchAndTagTips ?? '', this._options.tokenOptions.tips);
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

		if (CommitFormatter.has(template, 'avatar') && dateFormatOrOptions?.outputFormat) {
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

	static override has(
		template: string,
		...tokens: (keyof NonNullable<CommitFormatOptions['tokenOptions']>)[]
	): boolean {
		return super.has<CommitFormatOptions>(template, ...tokens);
	}
}

function getMarkdownActionCommand<T extends ActionContext>(action: Action<T>, args: Omit<T, 'type'>): string {
	return Command.getMarkdownCommandArgsCore(`${Commands.ActionPrefix}${action}`, {
		...args,
		type: action,
	});
}
