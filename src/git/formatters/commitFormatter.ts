import type { Uri } from 'vscode';
import { GitCommit } from '@gitlens/git/models/commit.js';
import { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import type { RemoteProvider } from '@gitlens/git/models/remoteProvider.js';
import { uncommitted, uncommittedStaged } from '@gitlens/git/models/revision.js';
import type { PreviousRangeComparisonUrisResult } from '@gitlens/git/providers/diff.js';
import { getHighlanderProviders } from '@gitlens/git/utils/remote.utils.js';
import { isUncommittedStaged, shortenRevision } from '@gitlens/git/utils/revision.utils.js';
import type { FormatOptions, RequiredTokenOptions } from '@gitlens/utils/formatter.js';
import { Formatter } from '@gitlens/utils/formatter.js';
import { join, map } from '@gitlens/utils/iterable.js';
import { escapeMarkdown } from '@gitlens/utils/markdown.js';
import { isPromise } from '@gitlens/utils/promise.js';
import type { TokenOptions } from '@gitlens/utils/string.js';
import { encodeHtmlWeak, getSuperscript } from '@gitlens/utils/string.js';
import type {
	Action,
	ActionContext,
	HoverCommandsActionContext,
	OpenPullRequestActionContext,
} from '../../api/gitlens.d.js';
import type { MaybeEnrichedAutolink } from '../../autolinks/models/autolinks.js';
import { getPresenceDataUri } from '../../avatars.js';
import { CopyShaToClipboardCommand } from '../../commands/copyShaToClipboard.js';
import { DiffWithCommand } from '../../commands/diffWith.js';
import { ExplainCommitCommand } from '../../commands/explainCommit.js';
import { ExplainWipCommand } from '../../commands/explainWip.js';
import { InspectCommand } from '../../commands/inspect.js';
import { OpenCommitOnRemoteCommand } from '../../commands/openCommitOnRemote.js';
import { OpenFileAtRevisionCommand } from '../../commands/openFileAtRevision.js';
import { ConnectRemoteProviderCommand } from '../../commands/remoteProviders.js';
import type { ShowQuickCommitCommandArgs } from '../../commands/showQuickCommit.js';
import { ShowQuickCommitFileCommand } from '../../commands/showQuickCommitFile.js';
import type { DateSource, DateStyle } from '../../config.js';
import { actionCommandPrefix } from '../../constants.commands.js';
import { GlyphChars } from '../../constants.js';
import type { Source } from '../../constants.telemetry.js';
import { Container } from '../../container.js';
import { emojify } from '../../emojis.js';
import { arePlusFeaturesEnabled } from '../../plus/gk/utils/-webview/plus.utils.js';
import { configuration } from '../../system/-webview/configuration.js';
import { editorLineToDiffRange } from '../../system/-webview/vscode/range.js';
import { createMarkdownCommandLink } from '../../system/commands.js';
import type { ContactPresence } from '../../vsls/vsls.js';
import type { ShowInCommitGraphCommandArgs } from '../../webviews/plus/graph/registration.js';
import {
	formatCommitDate,
	formatCommitDateFromNow,
	formatCommitStats,
	formatCurrentUserDisplayName,
	getCommitAuthorAvatarUri,
	getCommitGitUri,
} from '../utils/-webview/commit.utils.js';
import { getIssueOrPullRequestMarkdownIcon } from '../utils/-webview/icons.js';
import { getReferenceFromRevision } from '../utils/-webview/reference.utils.js';
import { isRemoteMaybeIntegrationConnected, remoteSupportsIntegration } from '../utils/-webview/remote.utils.js';

const quoteRegex = /"/g;
const newlineRegex = /\r?\n/g;
const lineStartRegex = /^/gm;

export interface CommitFormatOptions extends FormatOptions {
	ai?: { allowed: boolean; enabled: boolean };
	avatarSize?: number;
	dateSource?: DateSource;
	dateStyle?: DateStyle;
	editor?: { line: number; uri: Uri };
	footnotes?: Map<number, string>;
	getBranchAndTagTips?: (
		sha: string,
		options?: { compact?: boolean; icons?: boolean; pills?: boolean | { cssClass: string } },
	) => string | undefined;
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
	enrichedAutolinks?: Map<string, MaybeEnrichedAutolink>;
	messageAutolinks?: boolean;
	messageIndent?: number;
	messageTruncateAtNewLine?: boolean;
	pullRequest?: PullRequest | Promise<PullRequest | undefined>;
	pullRequestPendingMessage?: string;
	presence?: ContactPresence | Promise<ContactPresence | undefined>;
	previousLineComparisonUris?: PreviousRangeComparisonUrisResult;
	outputFormat?: 'html' | 'markdown' | 'plaintext';
	remotes?: GitRemote[];
	signed?: boolean;
	unpublished?: boolean;

	tokenOptions?: {
		ago?: TokenOptions;
		agoOrDate?: TokenOptions;
		agoOrDateShort?: TokenOptions;
		agoAndDate?: TokenOptions;
		agoAndDateShort?: TokenOptions;
		agoAndDateBothSources?: TokenOptions;
		author?: TokenOptions;
		authorFirst?: TokenOptions;
		authorLast?: TokenOptions;
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
		signature?: TokenOptions;
		stashName?: TokenOptions;
		stashNumber?: TokenOptions;
		stashOnRef?: TokenOptions;
		tips?: TokenOptions;
	};
	source: Source;
}

export class CommitFormatter extends Formatter<GitCommit, CommitFormatOptions> {
	declare protected _options: RequiredTokenOptions<CommitFormatOptions> &
		Required<Pick<CommitFormatOptions, 'outputFormat'>>;

	override reset(item: GitCommit, options?: CommitFormatOptions): void {
		super.reset(item, options);
		this._options.outputFormat ??= 'plaintext';
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
		return formatCommitDate(this._item, this._options.dateFormat);
	}

	private get _dateAgo() {
		return formatCommitDateFromNow(this._item);
	}

	private get _dateAgoShort() {
		return formatCommitDateFromNow(this._item, true);
	}

	private get _pullRequestDate() {
		const { pullRequest: pr } = this._options;
		if (pr == null || !PullRequest.is(pr)) return '';

		return PullRequest.formatDate(pr, this._options.dateFormat) ?? '';
	}

	private get _pullRequestDateAgo() {
		const { pullRequest: pr } = this._options;
		if (pr == null || !PullRequest.is(pr)) return '';

		return PullRequest.formatDateFromNow(pr) ?? '';
	}

	private get _pullRequestDateOrAgo() {
		const dateStyle = this._options.dateStyle ?? configuration.get('defaultDateStyle');
		return dateStyle === 'absolute' ? this._pullRequestDate : this._pullRequestDateAgo;
	}

	get ago(): string {
		return this._padOrTruncate(this._dateAgo, this._options.tokenOptions.ago);
	}

	get agoOrDate(): string {
		const dateStyle = this._options.dateStyle ?? configuration.get('defaultDateStyle');
		return this._padOrTruncate(
			dateStyle === 'absolute' ? this._date : this._dateAgo,
			this._options.tokenOptions.agoOrDate,
		);
	}

	get agoOrDateShort(): string {
		const dateStyle = this._options.dateStyle ?? configuration.get('defaultDateStyle');
		return this._padOrTruncate(
			dateStyle === 'absolute' ? this._date : this._dateAgoShort,
			this._options.tokenOptions.agoOrDateShort,
		);
	}

	get agoAndDate(): string {
		return this._padOrTruncate(
			this._options.outputFormat === 'markdown'
				? `${this._dateAgo} _(${this._date})_`
				: `${this._dateAgo} (${this._date})`,
			this._options.tokenOptions.agoAndDate,
		);
	}

	get agoAndDateBothSources(): string {
		const committerAgo = this.committerAgo;
		const committerDate = this.committerDate;
		const authorAgo = this.authorAgo;
		const authorDate = this.authorDate;

		const source = this._options.dateSource ?? configuration.get('defaultDateSource');

		if (source === 'committed') {
			return this._padOrTruncate(
				this._options.outputFormat === 'markdown'
					? `${committerAgo} _(${committerDate}${committerAgo === authorAgo ? '' : `, authored ${authorAgo}`})_`
					: `${committerAgo} (${committerDate}${committerAgo === authorAgo ? '' : `, authored ${authorAgo}`})`,
				this._options.tokenOptions.agoAndDateBothSources,
			);
		}

		return this._padOrTruncate(
			this._options.outputFormat === 'markdown'
				? `${authorAgo} _(${authorDate}${committerAgo === authorAgo ? '' : `, committed ${committerAgo}`})_`
				: `${authorAgo} (${authorDate}${committerAgo === authorAgo ? '' : `, committed ${committerAgo}`})`,
			this._options.tokenOptions.agoAndDateBothSources,
		);
	}

	get agoAndDateShort(): string {
		return this._padOrTruncate(
			this._options.outputFormat === 'markdown'
				? `${this._dateAgoShort} _(${this._date})_`
				: `${this._dateAgoShort} (${this._date})`,
			this._options.tokenOptions.agoAndDateShort,
		);
	}

	get author(): string {
		const name = this._item.author.current
			? formatCurrentUserDisplayName(this._item.author.name)
			: this._item.author.name;
		return this.formatAuthor(name, this._item.author.email, this._options.tokenOptions.author);
	}

	get authorFirst(): string {
		const style = this._item.author.current ? configuration.get('defaultCurrentUserNameStyle') : undefined;
		if (style === 'you') {
			return this.formatAuthor('You', this._item.author.email, this._options.tokenOptions.authorFirst);
		}
		// 'name', 'nameAndYou', or not current user — use raw name parts
		const [first] = this._item.author.name.split(' ');
		return this.formatAuthor(first, this._item.author.email, this._options.tokenOptions.authorFirst);
	}

	get authorLast(): string {
		const style = this._item.author.current ? configuration.get('defaultCurrentUserNameStyle') : undefined;
		if (style === 'you') {
			return this.formatAuthor('You', this._item.author.email, this._options.tokenOptions.authorLast);
		}
		// 'name', 'nameAndYou', or not current user — use raw name parts
		const [first, last] = this._item.author.name.split(' ');
		return this.formatAuthor(last || first, this._item.author.email, this._options.tokenOptions.authorLast);
	}

	private formatAuthor(name: string, email: string | undefined, tokenOptions: TokenOptions | undefined): string {
		const author = this._padOrTruncate(name, tokenOptions);

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
		const dateStyle = this._options.dateStyle ?? configuration.get('defaultDateStyle');
		return this._padOrTruncate(
			dateStyle === 'absolute' ? this._authorDate : this._authorDateAgo,
			this._options.tokenOptions.authorAgoOrDate,
		);
	}

	get authorAgoOrDateShort(): string {
		const dateStyle = this._options.dateStyle ?? configuration.get('defaultDateStyle');
		return this._padOrTruncate(
			dateStyle === 'absolute' ? this._authorDate : this._authorDateAgoShort,
			this._options.tokenOptions.authorAgoOrDateShort,
		);
	}

	get authorDate(): string {
		return this._padOrTruncate(this._authorDate, this._options.tokenOptions.authorDate);
	}

	get authorNotYou(): string {
		let { name, email } = this._item.author;
		if (this._item.author.current) return this._padOrTruncate('', this._options.tokenOptions.authorNotYou);

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

		let name = this._item.author.current
			? formatCurrentUserDisplayName(this._item.author.name)
			: this._item.author.name;

		let presence = this._options.presence;
		// If we are still waiting for the presence, pretend it is offline
		if (isPromise(presence)) {
			presence = {
				status: 'offline',
				statusText: 'Offline',
			};
		}
		if (presence != null) {
			let title = `${name} ${this._item.author.current ? 'are' : 'is'} ${
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
		const avatarPromise = getCommitAuthorAvatarUri(this._item, {
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
		if (!GitCommit.is(this._item) || this._item.stats == null) {
			return this._padOrTruncate('', this._options.tokenOptions.changes);
		}

		const stats = formatCommitStats(
			this._item.stats,
			'stats',
			this._options.outputFormat !== 'plaintext' ? { color: true } : undefined,
		);
		return this._padOrTruncate(stats, this._options.tokenOptions.changes);
	}

	get changesDetail(): string {
		if (!GitCommit.is(this._item) || this._item.stats == null) {
			return this._padOrTruncate('', this._options.tokenOptions.changesDetail);
		}

		let stats = formatCommitStats(
			this._item.stats,
			'stats',
			this._options.outputFormat !== 'plaintext' ? { color: true } : undefined,
		);
		const statsExpanded = formatCommitStats(this._item.stats, 'expanded', {
			addParenthesesToFileStats: true,
			color: this._options.outputFormat !== 'plaintext',
			separator: ', ',
		});
		if (statsExpanded) {
			stats += ` ${statsExpanded}`;
		}

		return this._padOrTruncate(stats, this._options.tokenOptions.changesDetail);
	}

	get changesShort(): string {
		if (!GitCommit.is(this._item) || this._item.stats == null) {
			return this._padOrTruncate('', this._options.tokenOptions.changesShort);
		}

		const stats = formatCommitStats(this._item.stats, 'short', { separator: '' });
		return this._padOrTruncate(stats, this._options.tokenOptions.changesShort);
	}

	get commands(): string {
		// TODO: Implement html rendering
		if (this._options.outputFormat === 'plaintext' || this._options.outputFormat === 'html') {
			return this._padOrTruncate('', this._options.tokenOptions.commands);
		}

		const separator = ' &nbsp;&nbsp;|&nbsp;&nbsp; ';
		const editorHoverSource = { source: this._options.source.source, detail: 'actions-row' };

		let commands;
		if (this._item.isUncommitted) {
			const { previousLineComparisonUris: diffUris } = this._options;
			if (diffUris?.previous != null) {
				commands = `[\`${this._padOrTruncate(
					shortenRevision(isUncommittedStaged(diffUris.current.sha) ? diffUris.current.sha : uncommitted),
					this._options.tokenOptions.commands,
				)}\`](${InspectCommand.createMarkdownCommandLink(
					this._item.sha,
					this._item.repoPath,
					editorHoverSource,
				)} "Inspect Commit Details")`;

				commands += ` &nbsp;[$(compare-changes)](${DiffWithCommand.createMarkdownCommandLink({
					lhs: { sha: diffUris.previous.sha ?? '', uri: diffUris.previous.uri },
					rhs: { sha: diffUris.current.sha ?? '', uri: diffUris.current.uri },
					repoPath: this._item.repoPath,
					range: editorLineToDiffRange(this._options.editor?.line),
					source: editorHoverSource,
				})} "Open Changes with Previous Revision")`;

				commands += ` &nbsp;[$(versions)](${OpenFileAtRevisionCommand.createMarkdownCommandLink(
					diffUris.previous.uri,
					'blame',
					editorLineToDiffRange(this._options.editor?.line),
					editorHoverSource,
				)} "Open Blame Prior to this Change")`;
			} else {
				commands = `[\`${this._padOrTruncate(
					shortenRevision(this._item.isUncommittedStaged ? uncommittedStaged : uncommitted),
					this._options.tokenOptions.commands,
				)}\`](${InspectCommand.createMarkdownCommandLink(
					this._item.sha,
					this._item.repoPath,
					editorHoverSource,
				)} "Inspect Commit Details")`;
			}

			if (this._options.ai?.enabled && this._options.ai?.allowed) {
				commands += `${separator}[$(sparkle) Explain](${ExplainWipCommand.createMarkdownCommandLink({
					repoPath: this._item.repoPath,
					staged: undefined,
					source: { source: this._options.source.source, context: { type: 'wip' } },
				})} "Explain Changes")`;
			}

			return commands;
		}

		commands = `---\n\n[\`$(git-commit) ${this.id}\`](${InspectCommand.createMarkdownCommandLink(
			this._item.sha,
			this._item.repoPath,
			editorHoverSource,
		)} "Inspect Commit Details")`;

		commands += ` &nbsp;[$(copy)](${CopyShaToClipboardCommand.createMarkdownCommandLink(
			this._item.sha,
			editorHoverSource,
		)} "Copy SHA")`;

		commands += ` &nbsp;[$(compare-changes)](${DiffWithCommand.createMarkdownCommandLink(
			this._item,
			editorLineToDiffRange(this._options.editor?.line),
			editorHoverSource,
		)} "Open Changes with Previous Revision")`;

		if (this._item.file != null && this._item.unresolvedPreviousSha != null) {
			const uri = Container.instance.git
				.getRepositoryService(this._item.repoPath)
				.getRevisionUri(
					this._item.unresolvedPreviousSha,
					this._item.file.originalPath ?? this._item.file?.path,
				);
			commands += ` &nbsp;[$(versions)](${OpenFileAtRevisionCommand.createMarkdownCommandLink(
				uri,
				'blame',
				editorLineToDiffRange(this._options.editor?.line),
				editorHoverSource,
			)} "Open Blame Prior to this Change")`;
		}

		commands += `${separator}[$(search)](${createMarkdownCommandLink<ShowQuickCommitCommandArgs>(
			'gitlens.revealCommitInView',
			{ repoPath: this._item.repoPath, sha: this._item.sha, revealInView: true, source: editorHoverSource },
		)} "Reveal in Side Bar")`;

		if (arePlusFeaturesEnabled()) {
			commands += ` &nbsp;[$(gitlens-graph)](${createMarkdownCommandLink<ShowInCommitGraphCommandArgs>(
				'gitlens.showInCommitGraph',
				// Avoid including the message here, it just bloats the command url
				{ ref: getReferenceFromRevision(this._item, { excludeMessage: true }), source: editorHoverSource },
			)} "Open in Commit Graph")`;
		}

		const { pullRequest: pr, remotes } = this._options;

		if (remotes?.length) {
			const providers = getHighlanderProviders(remotes as GitRemote<RemoteProvider>[]);

			commands += ` &nbsp;[$(globe)](${OpenCommitOnRemoteCommand.createMarkdownCommandLink(
				this._item.sha,
				editorHoverSource,
			)} "Open Commit on ${providers?.length ? providers[0].name : 'Remote'}")`;
		}

		if (this._options.ai?.enabled && this._options.ai?.allowed) {
			commands += `${separator}[$(sparkle) Explain](${ExplainCommitCommand.createMarkdownCommandLink({
				repoPath: this._item.repoPath,
				rev: this._item.sha,
				source: {
					source: 'editor:hover',
					context: { type: GitCommit.isStash(this._item) ? 'stash' : 'commit' },
				},
			})} "Explain Changes")`;
		}

		if (pr != null) {
			if (PullRequest.is(pr)) {
				commands += `${separator}[$(git-pull-request) PR #${
					pr.id
				}](${createMarkdownActionCommandLink<OpenPullRequestActionContext>('openPullRequest', {
					repoPath: this._item.repoPath,
					provider: { id: pr.provider.id, name: pr.provider.name, domain: pr.provider.domain },
					pullRequest: { id: pr.id, url: pr.url },
					source: editorHoverSource,
				})} "Open Pull Request \\#${pr.id}${
					Container.instance.actionRunners.count('openPullRequest') === 1 ? ` on ${pr.provider.name}` : '...'
				}\n${GlyphChars.Dash.repeat(2)}\n${escapeMarkdown(pr.title).replace(quoteRegex, '\\"')}\n${
					pr.state
				}, ${PullRequest.formatDateFromNow(pr)}")`;
			} else if (isPromise(pr)) {
				commands += `${separator}[$(git-pull-request) PR $(loading~spin)](${createMarkdownCommandLink(
					'gitlens.refreshHover',
					editorHoverSource,
				)} "Searching for a Pull Request (if any) that introduced this commit...")`;
			}
		} else if (remotes != null) {
			const [remote] = remotes;
			if (
				remote != null &&
				remoteSupportsIntegration(remote) &&
				!isRemoteMaybeIntegrationConnected(remote) &&
				configuration.get('integrations.enabled')
			) {
				commands += `${separator}[$(plug) Connect to ${remote?.provider.name}${
					GlyphChars.Ellipsis
				}](${ConnectRemoteProviderCommand.createMarkdownCommandLink(remote, editorHoverSource)} "Connect to ${
					remote.provider.name
				} to enable the display of the Pull Request (if any) that introduced this commit")`;
			}
		}

		if (Container.instance.actionRunners.count('hover.commands') > 0) {
			const { name, email } = this._item.author;

			commands += `${separator}[$(organization)](${createMarkdownActionCommandLink<HoverCommandsActionContext>(
				'hover.commands',
				{
					repoPath: this._item.repoPath,
					commit: {
						sha: this._item.sha,
						author: { name: name, email: email, presence: this._options.presence },
					},
					file:
						this._options.editor != null
							? { uri: this._options.editor?.uri.toString(), line: this._options.editor?.line }
							: undefined,
					source: editorHoverSource,
				},
			)} "Show Team Actions")`;
		}

		const gitUri = getCommitGitUri(this._item);
		commands += `${separator}[$(ellipsis)](${ShowQuickCommitFileCommand.createMarkdownCommandLink(
			gitUri != null
				? {
						revisionUri: Container.instance.git.getRevisionUriFromGitUri(gitUri).toString(true),
						source: editorHoverSource,
					}
				: { commit: this._item, source: editorHoverSource },
		)} "Show More Actions")`;

		return this._padOrTruncate(commands, this._options.tokenOptions.commands);
	}

	get committerAgo(): string {
		return this._padOrTruncate(this._committerDateAgo, this._options.tokenOptions.committerAgo);
	}

	get committerAgoOrDate(): string {
		const dateStyle = this._options.dateStyle ?? configuration.get('defaultDateStyle');
		return this._padOrTruncate(
			dateStyle === 'absolute' ? this._committerDate : this._committerDateAgo,
			this._options.tokenOptions.committerAgoOrDate,
		);
	}

	get committerAgoOrDateShort(): string {
		const dateStyle = this._options.dateStyle ?? configuration.get('defaultDateStyle');
		return this._padOrTruncate(
			dateStyle === 'absolute' ? this._committerDate : this._committerDateAgoShort,
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
		if (this._options.footnotes == null || this._options.footnotes.size === 0) return '';

		const { footnotes, outputFormat } = this._options;

		// Aggregate similar footnotes
		const notes = new Map<string, string[]>();
		for (const [i, footnote] of footnotes) {
			let note = notes.get(footnote);
			if (note == null) {
				note = [getSuperscript(i)];
				notes.set(footnote, note);
			} else {
				note.push(getSuperscript(i));
			}
		}

		if (outputFormat === 'plaintext') {
			return this._padOrTruncate(
				join(
					map(notes, ([footnote, indices]) => `${indices.join(',')} ${footnote}`),
					'\n',
				),
				this._options.tokenOptions.footnotes,
			);
		}

		return this._padOrTruncate(
			join(
				notes.keys(),
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
		let icon;
		let label;
		if (GitCommit.isStash(this._item)) {
			icon = 'archive';
			label = this._padOrTruncate(
				`Stash${this._item.stashNumber ? ` #${this._item.stashNumber}` : ''}`,
				this._options.tokenOptions.link,
			);
		} else {
			icon = this._item.sha != null && !this._item.isUncommitted ? 'git-commit' : '';
			label = this._padOrTruncate(
				shortenRevision(this._item.sha ?? '', { strings: { working: 'Working Tree' } }),
				this._options.tokenOptions.id,
			);
		}

		let link;
		switch (this._options.outputFormat) {
			case 'markdown':
				icon = icon ? `$(${icon}) ` : '';
				link = `[\`${icon}${label}\`](${InspectCommand.createMarkdownCommandLink({
					ref: getReferenceFromRevision(this._item),
					source: this._options.source,
				})} "Inspect Commit Details")`;
				break;
			case 'html':
				icon = icon ? `<span class="codicon codicon-${icon}"></span>` : '';
				link = /*html*/ `<a href="${InspectCommand.createMarkdownCommandLink({
					ref: getReferenceFromRevision(this._item),
					source: this._options.source,
				})}" title="Inspect Commit Details"${
					this._options.htmlFormat?.classes?.link ? ` class="${this._options.htmlFormat.classes.link}"` : ''
				}>${icon}${label}</a>`;
				break;
			default:
				link = this.id;
				break;
		}

		return this._padOrTruncate(link, this._options.tokenOptions.link);
	}

	get message(): string {
		const { outputFormat } = this._options;

		if (this._item.isUncommitted) {
			const conflicted = this._item.file?.hasConflicts ?? false;
			const staged =
				this._item.isUncommittedStaged ||
				isUncommittedStaged(this._options.previousLineComparisonUris?.current?.sha);

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
					message = `\n\n${message}`;
					break;
			}
			return this._padOrTruncate(message, this._options.tokenOptions.message);
		}

		let message = (
			this._options.messageTruncateAtNewLine ? this._item.summary : (this._item.message ?? this._item.summary)
		)
			.trim()
			.replace(newlineRegex, '\n');

		message = emojify(message);
		message = this._padOrTruncate(message, this._options.tokenOptions.message);

		if (outputFormat !== 'plaintext') {
			message = encodeHtmlWeak(message);
		}
		if (outputFormat === 'markdown') {
			// Block image embeds to prevent tracking pixels from commit messages
			message = message.replace(/!\[/g, '&#33;&#91;');
		}

		if (this._options.messageAutolinks) {
			message = Container.instance.autolinks.linkify(
				message,
				outputFormat,
				this._options.remotes,
				this._options.enrichedAutolinks,
				this._options.pullRequest != null && !isPromise(this._options.pullRequest)
					? new Set([this._options.pullRequest.id])
					: undefined,
				this._options.footnotes,
				this._options.source,
			);
		}

		if (this._options.messageIndent != null && outputFormat === 'plaintext') {
			message = message.replace(lineStartRegex, GlyphChars.Space.repeat(this._options.messageIndent));
		}

		switch (outputFormat) {
			case 'html':
				return /*html*/ `<span ${
					this._options.htmlFormat?.classes?.id ? `class="${this._options.htmlFormat.classes.id}"` : ''
				}>${message}</span>`;
			case 'markdown':
				return `\n\n${message}`;
			default:
				return message;
		}
	}

	get pullRequest(): string {
		const { pullRequest: pr } = this._options;
		// TODO: Implement html rendering
		if (pr == null || this._options.outputFormat === 'html') {
			return this._padOrTruncate('', this._options.tokenOptions.pullRequest);
		}

		let text;
		if (PullRequest.is(pr)) {
			if (this._options.outputFormat === 'markdown') {
				text = `[**$(git-pull-request) PR #${
					pr.id
				}**](${createMarkdownActionCommandLink<OpenPullRequestActionContext>('openPullRequest', {
					repoPath: this._item.repoPath,
					provider: { id: pr.provider.id, name: pr.provider.name, domain: pr.provider.domain },
					pullRequest: { id: pr.id, url: pr.url },
					source: this._options.source,
				})} "Open Pull Request \\#${pr.id}${
					Container.instance.actionRunners.count('openPullRequest') === 1 ? ` on ${pr.provider.name}` : '...'
				}\n${GlyphChars.Dash.repeat(2)}\n${escapeMarkdown(pr.title).replace(quoteRegex, '\\"')}\n${
					pr.state
				}, ${PullRequest.formatDateFromNow(pr)}")`;

				if (this._options.footnotes != null) {
					const prTitle = escapeMarkdown(pr.title).replace(quoteRegex, '\\"').trim();

					const index = this._options.footnotes.size + 1;
					const prCommandLink = createMarkdownActionCommandLink<OpenPullRequestActionContext>(
						'openPullRequest',
						{
							repoPath: this._item.repoPath,
							provider: { id: pr.provider.id, name: pr.provider.name, domain: pr.provider.domain },
							pullRequest: { id: pr.id, url: pr.url },
							source: { source: this._options.source.source, detail: 'footnote' },
						},
					);
					this._options.footnotes.set(
						index,
						`${getIssueOrPullRequestMarkdownIcon(pr)} [**${prTitle}**](${prCommandLink} "Open Pull Request \\#${
							pr.id
						} on ${pr.provider.name}")\\\n${GlyphChars.Space.repeat(4)} #${pr.id} ${
							pr.state
						} ${PullRequest.formatDateFromNow(pr)}`,
					);
				}
			} else if (this._options.footnotes != null) {
				const index = this._options.footnotes.size + 1;
				this._options.footnotes.set(
					index,
					`PR #${pr.id}: ${pr.title}  ${GlyphChars.Dot}  ${pr.state}, ${PullRequest.formatDateFromNow(pr)}`,
				);

				text = `PR #${pr.id}${getSuperscript(index)}`;
			} else {
				text = `PR #${pr.id}`;
			}
		} else if (isPromise(pr)) {
			text =
				this._options.outputFormat === 'markdown'
					? `[PR $(loading~spin)](${createMarkdownCommandLink('gitlens.refreshHover', this._options.source)} "Searching for a Pull Request (if any) that introduced this commit...")`
					: (this._options?.pullRequestPendingMessage ?? '');
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
		const { pullRequest: pr } = this._options;
		return this._padOrTruncate(
			pr == null || !PullRequest.is(pr) ? '' : (pr.state ?? ''),
			this._options.tokenOptions.pullRequestState,
		);
	}

	get sha(): string {
		return this._padOrTruncate(this._item.shortSha ?? '', this._options.tokenOptions.sha);
	}

	get signature(): string {
		const { signed } = this._options;
		if (!signed || this._options.outputFormat === 'plaintext') {
			return this._padOrTruncate('', this._options.tokenOptions.signature);
		}

		const tooltip = 'Signed\nClick to verify signature in Commit Details';

		return this._padOrTruncate(
			this._options.outputFormat === 'markdown'
				? ` [$(workspace-unknown)](${InspectCommand.createMarkdownCommandLink(
						this._item.sha,
						this._item.repoPath,
						this._options.source,
					)} "${tooltip}")`
				: '',
			this._options.tokenOptions.signature,
		);
	}

	get stashName(): string {
		return this._padOrTruncate(this._item.stashName ?? '', this._options.tokenOptions.stashName);
	}

	get stashNumber(): string {
		return this._padOrTruncate(this._item.stashNumber ?? '', this._options.tokenOptions.stashNumber);
	}

	get stashOnRef(): string {
		return this._padOrTruncate(this._item.stashOnRef ?? '', this._options.tokenOptions.stashOnRef);
	}

	get tips(): string {
		const branchAndTagTips = this._options.getBranchAndTagTips?.(this._item.sha, {
			icons: this._options.outputFormat === 'markdown',
			pills:
				this._options.outputFormat === 'markdown'
					? true
					: this._options.outputFormat === 'html'
						? this._options.htmlFormat?.classes?.tips
							? { cssClass: this._options.htmlFormat.classes.tips }
							: true
						: false,
		});
		return this._padOrTruncate(branchAndTagTips ?? '', this._options.tokenOptions.tips);
	}

	static fromTemplate(template: string, commit: GitCommit, dateFormat: string | null): string;
	static fromTemplate(template: string, commit: GitCommit, options?: Omit<CommitFormatOptions, 'source'>): string;
	static fromTemplate(
		template: string,
		commit: GitCommit,
		dateFormatOrOptions?: string | null | Omit<CommitFormatOptions, 'source'>,
	): string;
	static fromTemplate(
		template: string,
		commit: GitCommit,
		dateFormatOrOptions?: string | null | Omit<CommitFormatOptions, 'source'>,
	): string {
		if (dateFormatOrOptions == null || typeof dateFormatOrOptions === 'string') {
			dateFormatOrOptions = {
				dateFormat: dateFormatOrOptions,
			};
		}

		if (CommitFormatter.has(template, 'footnotes')) {
			dateFormatOrOptions.footnotes ??= new Map<number, string>();
		}

		if (CommitFormatter.has(template, 'avatar') && dateFormatOrOptions?.outputFormat) {
			debugger;
			throw new Error("Invalid template token 'avatar' used in non-async call");
		}

		return super.fromTemplateCore(this, template, commit, dateFormatOrOptions);
	}

	static fromTemplateAsync(
		template: string,
		commit: GitCommit,
		source: Source,
		dateFormat: string | null,
	): Promise<string>;
	static fromTemplateAsync(
		template: string,
		commit: GitCommit,
		source: Source,
		options?: Omit<CommitFormatOptions, 'source'>,
	): Promise<string>;
	static fromTemplateAsync(
		template: string,
		commit: GitCommit,
		source: Source,
		dateFormatOrOptions?: string | null | Omit<CommitFormatOptions, 'source'>,
	): Promise<string>;
	static fromTemplateAsync(
		template: string,
		commit: GitCommit,
		source: Source,
		dateFormatOrOptions?: string | null | Omit<CommitFormatOptions, 'source'>,
	): Promise<string> {
		if (dateFormatOrOptions == null || typeof dateFormatOrOptions === 'string') {
			dateFormatOrOptions = {
				dateFormat: dateFormatOrOptions,
			};
		}
		if (CommitFormatter.has(template, 'footnotes')) {
			dateFormatOrOptions.footnotes ??= new Map<number, string>();
		}

		return super.fromTemplateCoreAsync(this, template, commit, { ...dateFormatOrOptions, source: source });
	}

	static override has(
		template: string,
		...tokens: (keyof NonNullable<CommitFormatOptions['tokenOptions']>)[]
	): boolean {
		return super.has<CommitFormatOptions>(template, ...tokens);
	}
}

function createMarkdownActionCommandLink<T extends ActionContext>(action: Action<T>, args: Omit<T, 'type'>): string {
	return createMarkdownCommandLink(`${actionCommandPrefix}${action}`, {
		...args,
		type: action,
	});
}
