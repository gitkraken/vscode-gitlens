import type { Uri } from 'vscode';
import { l10n, MarkdownString, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import { GitContributor } from '@gitlens/git/models/contributor.js';
import type { GitLog } from '@gitlens/git/models/log.js';
import { formatMarkdownCode } from '@gitlens/git/utils/tooltip.utils.js';
import { trace } from '@gitlens/utils/decorators/log.js';
import { map } from '@gitlens/utils/iterable.js';
import { escapeMarkdown, escapeMarkdownLinkTitle } from '@gitlens/utils/markdown.js';
import { formatPlural } from '@gitlens/utils/plural.js';
import { getPresenceDataUri } from '../../avatars.js';
import { GlyphChars } from '../../constants.js';
import type { GitUri } from '../../git/gitUri.js';
import type { FilesQueryResults } from '../../git/queryResults.js';
import { formatCurrentUserDisplayName } from '../../git/utils/-webview/commit.utils.js';
import { getContributorAvatarUri } from '../../git/utils/-webview/contributor.utils.js';
import { configuration } from '../../system/-webview/configuration.js';
import { gate } from '../../system/decorators/gate.js';
import type { ContactPresence } from '../../vsls/vsls.js';
import type { ViewsWithContributors } from '../viewBase.js';
import type { ClipboardType, PageableViewNode } from './abstract/viewNode.js';
import { ContextValues, getViewNodeId, ViewNode } from './abstract/viewNode.js';
import { CommitNode } from './commitNode.js';
import { LoadMoreNode, MessageNode } from './common.js';
import { FileRevisionAsCommitNode } from './fileRevisionAsCommitNode.js';
import { ResultsFilesNode } from './resultsFilesNode.js';
import { insertDateMarkers } from './utils/-webview/node.utils.js';

const markdownCodeToken = '\ue000code\ue001';

export type ContributorFilesComparison = {
	ref1: string;
	ref2: string;
	query: () => Promise<FilesQueryResults>;
	direction?: 'ahead' | 'behind';
	invalidate?: () => void;
};

function getMarkdownMailto(email: string): string {
	const encodedEmail = encodeURIComponent(email).replace(
		/[!'()*]/g,
		character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
	);
	return `mailto:${encodedEmail.replaceAll('%40', '@')}`;
}

function formatLocalizedMarkdownWithCode(localized: string, code: string): string {
	return escapeMarkdown(localized).replaceAll(markdownCodeToken, formatMarkdownCode(code));
}

export class ContributorNode extends ViewNode<'contributor', ViewsWithContributors> implements PageableViewNode {
	limit: number | undefined;

	constructor(
		uri: GitUri,
		view: ViewsWithContributors,
		protected override readonly parent: ViewNode,
		public readonly contributor: GitContributor,
		private readonly options?: {
			all?: boolean;
			files?: ContributorFilesComparison;
			ref?: string;
			presence: Map<string, ContactPresence> | undefined;
			showMergeCommits?: boolean;
			showStatistics?: boolean;
			pathspec?: { uri: Uri; isFolder: boolean };
		},
	) {
		super('contributor', uri, view, parent);

		this.updateContext({ contributor: contributor });
		this._uniqueId = getViewNodeId(this.type, this.context);
		this.limit = this.view.getNodeLastKnownLimit(this);
	}

	override get id(): string {
		return this._uniqueId;
	}

	override toClipboard(type?: ClipboardType): string {
		const text = `${this.contributor.name}${this.contributor.email ? ` <${this.contributor.email}>` : ''}`;
		switch (type) {
			case 'markdown':
				return this.contributor.email
					? `[${escapeMarkdown(text)}](${getMarkdownMailto(this.contributor.email)})`
					: escapeMarkdown(text);
			default:
				return text;
		}
	}

	override getUrl(): string {
		return this.contributor.email ? `mailto:${this.contributor.email}` : '';
	}

	get repoPath(): string {
		return this.contributor.repoPath;
	}

	async getChildren(): Promise<ViewNode[]> {
		const log = await this.getLog();
		if (log == null) return [new MessageNode(this.view, this, l10n.t('No commits could be found.'))];

		const hasPathspec = this.options?.pathspec != null;
		const useFileRevisionAsCommit = this.options?.pathspec != null && !this.options.pathspec.isFolder;

		const getBranchAndTagTips = await this.view.container.git
			.getRepositoryService(this.uri.repoPath!)
			.getBranchesAndTagsTipsLookup();
		const children: ViewNode[] = [
			...insertDateMarkers(
				map(log.commits.values(), c =>
					useFileRevisionAsCommit
						? new FileRevisionAsCommitNode(this.view, this, c.file!, c, {
								getBranchAndTagTips: getBranchAndTagTips,
							})
						: new CommitNode(this.view, this, c, undefined, undefined, getBranchAndTagTips, {
								allowFilteredFiles: hasPathspec,
							}),
				),
				this,
			),
		];

		const files = this.options?.files;
		if (files != null) {
			children.unshift(
				new ResultsFilesNode(
					this.view,
					this,
					this.repoPath,
					files.ref1,
					files.ref2,
					files.query,
					files.direction,
					{
						expand: false,
						label: l10n.t('Files Touched'),
						onRefresh: files.invalidate,
						tooltip: l10n.t(
							"Files touched by this contributor's non-merge commits. Diffs show the final changes across the comparison, including changes by other contributors to these files.",
						),
					},
				),
			);
		}

		if (log.hasMore) {
			children.push(new LoadMoreNode(this.view, this, children.at(-1)!));
		}
		return children;
	}

	async getTreeItem(): Promise<TreeItem> {
		const presence = this.options?.presence?.get(this.contributor.email!);
		const contributorStats = this.options?.showStatistics === false ? undefined : this.contributor.stats;

		let shortStats = '';
		if (contributorStats != null) {
			const lines = contributorStats.additions + contributorStats.deletions;
			shortStats = formatPlural(
				l10n.t(
					'{files, plural, one{{lines, plural, one{ ({files} file, +{additions} -{deletions} line)} other{ ({files} file, +{additions} -{deletions} lines)}}} other{{lines, plural, one{ ({files} files, +{additions} -{deletions} line)} other{ ({files} files, +{additions} -{deletions} lines)}}}}',
				),
				{
					files: contributorStats.files,
					additions: contributorStats.additions,
					deletions: contributorStats.deletions,
					lines: lines,
				},
			);
		}

		const displayName = this.contributor.current
			? formatCurrentUserDisplayName(this.contributor.label)
			: this.contributor.label;

		const item = new TreeItem(displayName, TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.contextValue = this.contributor.current
			? `${ContextValues.Contributor}+current`
			: ContextValues.Contributor;
		const commitCount = formatPlural(l10n.t('{0, plural, one{{0} commit} other{{0} commits}}'), [
			this.contributor.contributionCount,
		]);
		let presenceLabel = '';
		if (presence != null && presence.status !== 'offline') {
			switch (presence.status) {
				case 'online':
					presenceLabel = l10n.t('Available');
					break;
				case 'away':
					presenceLabel = l10n.t('Away');
					break;
				case 'busy':
					presenceLabel = l10n.t('Busy');
					break;
				case 'dnd':
					presenceLabel = l10n.t('DND');
					break;
			}
			presenceLabel += ` ${GlyphChars.Space}${GlyphChars.Dot}${GlyphChars.Space} `;
		}
		item.description = `${presenceLabel}${
			this.contributor.latestCommitDate != null ? `${GitContributor.formatDateFromNow(this.contributor)}, ` : ''
		}${commitCount}${shortStats}`;

		let avatarUri;
		let avatarMarkdown;
		if (this.view.config.avatars) {
			const size = configuration.get('hovers.avatarSize');
			avatarUri = await getContributorAvatarUri(this.contributor, {
				defaultStyle: configuration.get('defaultGravatarsStyle'),
				size: size,
			});

			if (presence != null) {
				let displayName = this.contributor.label;
				let currentUserStyle = false;
				if (this.contributor.current) {
					const style = configuration.get('defaultCurrentUserNameStyle');
					displayName = formatCurrentUserDisplayName(this.contributor.label, style);
					currentUserStyle = style === 'you';
				}

				let title: string;
				if (currentUserStyle) {
					switch (presence.status) {
						case 'online':
							title = l10n.t('{0} are available', displayName);
							break;
						case 'away':
							title = l10n.t('{0} are away', displayName);
							break;
						case 'busy':
							title = l10n.t('{0} are busy', displayName);
							break;
						case 'dnd':
							title = l10n.t('{0} are in dnd', displayName);
							break;
						case 'offline':
							title = l10n.t('{0} are offline', displayName);
							break;
					}
				} else {
					switch (presence.status) {
						case 'online':
							title = l10n.t('{0} is available', displayName);
							break;
						case 'away':
							title = l10n.t('{0} is away', displayName);
							break;
						case 'busy':
							title = l10n.t('{0} is busy', displayName);
							break;
						case 'dnd':
							title = l10n.t('{0} is in dnd', displayName);
							break;
						case 'offline':
							title = l10n.t('{0} is offline', displayName);
							break;
					}
				}

				const escapedTitle = escapeMarkdown(title);
				const escapedLinkTitle = escapeMarkdownLinkTitle(title);
				avatarMarkdown = `![${escapedTitle}](${avatarUri.toString(
					true,
				)}|width=${size},height=${size} "${escapedLinkTitle}")![${escapedTitle}](${getPresenceDataUri(
					presence.status,
				)} "${escapedLinkTitle}")`;
			} else {
				const escapedLabel = escapeMarkdown(this.contributor.label);
				avatarMarkdown = `![${escapedLabel}](${avatarUri.toString(
					true,
				)}|width=${size},height=${size} "${escapeMarkdownLinkTitle(this.contributor.label)}")`;
			}
		}

		const stats =
			contributorStats != null
				? `\\\n${escapeMarkdown(
						formatPlural(l10n.t('{0, plural, one{{0} file changed} other{{0} files changed}}'), [
							contributorStats.files,
						]),
					)}, ${escapeMarkdown(
						formatPlural(l10n.t('{0, plural, one{{0} addition} other{{0} additions}}'), [
							contributorStats.additions,
						]),
					)}, ${escapeMarkdown(
						formatPlural(l10n.t('{0, plural, one{{0} deletion} other{{0} deletions}}'), [
							contributorStats.deletions,
						]),
					)}`
				: '';

		const link = this.contributor.email
			? `__[${escapeMarkdown(this.contributor.name)}](${getMarkdownMailto(
					this.contributor.email,
				)} "${escapeMarkdownLinkTitle(
					l10n.t('Email {0} ({1})', this.contributor.label, this.contributor.email),
				)}")__`
			: `__${escapeMarkdown(this.contributor.label)}__`;

		const lastCommitted =
			this.contributor.latestCommitDate != null
				? `${escapeMarkdown(
						l10n.t(
							'Last commit {0} ({1})',
							GitContributor.formatDateFromNow(this.contributor),
							GitContributor.formatDate(this.contributor),
						),
					)}\\\n`
				: '';

		const path = this.options?.pathspec?.uri
			? this.view.container.git.getRelativePath(this.options.pathspec.uri, this.uri.repoPath!)
			: undefined;
		const contributions =
			path == null
				? escapeMarkdown(commitCount)
				: formatLocalizedMarkdownWithCode(
						formatPlural(l10n.t('{0, plural, one{{0} commit to {1}} other{{0} commits to {1}}}'), [
							this.contributor.contributionCount,
							markdownCodeToken,
						]),
						path,
					);
		const markdown = new MarkdownString(
			`${avatarMarkdown ?? ''} &nbsp;${link} \n\n${lastCommitted}${contributions}${stats}`,
		);
		markdown.supportHtml = true;

		item.tooltip = markdown;
		item.iconPath = avatarUri;

		return item;
	}

	@trace()
	override refresh(reset?: boolean): void {
		if (reset) {
			this._log = undefined;
			this.options?.files?.invalidate?.();
		}
	}

	private _log: GitLog | undefined;
	private async getLog() {
		const svc = this.view.container.git.getRepositoryService(this.uri.repoPath!);

		const { name, email, username, id } = this.contributor;

		// If a Uri is provided, get log for the specific path, otherwise get all commits by author
		if (this.options?.pathspec?.uri) {
			this._log ??= await svc.commits.getLogForPath(this.uri, this.options?.ref, {
				all: this.options?.all,
				authors: [{ name: name, email: email, username: username, id: id }],
				isFolder: this.options?.pathspec.isFolder,
				limit: this.limit ?? this.view.config.defaultItemLimit,
				merges: this.options?.showMergeCommits,
			});
		} else {
			this._log ??= await svc.commits.getLog(this.options?.ref, {
				all: this.options?.all,
				authors: [{ name: name, email: email, username: username, id: id }],
				limit: this.limit ?? this.view.config.defaultItemLimit,
				merges: this.options?.showMergeCommits,
			});
		}
		return this._log;
	}

	get hasMore(): boolean {
		return this._log?.hasMore ?? true;
	}

	@gate()
	async loadMore(limit?: number | { until?: any }): Promise<void> {
		let log = await window.withProgress({ location: { viewId: this.view.id } }, () => this.getLog());
		if (!log?.hasMore) return;

		log = await log.more?.(limit ?? this.view.config.pageItemLimit);
		if (this._log === log) return;

		this._log = log;
		this.limit = log?.count;

		void this.triggerChange(false);
	}
}
