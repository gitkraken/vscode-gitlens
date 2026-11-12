import { l10n, MarkdownString, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import { formatPullRequestMergeQueueStatus, isPullRequestInMergeQueue } from '@gitlens/git/utils/pullRequest.utils.js';
import { fromNow } from '@gitlens/utils/date.js';
import { escapeMarkdown, escapeMarkdownLinkTitle, getMarkdownWebLinkDestination } from '@gitlens/utils/markdown.js';
import { isPromise } from '@gitlens/utils/promise.js';
import type { Autolink } from '../../autolinks/models/autolinks.js';
import { GitUri } from '../../git/gitUri.js';
import { getIssueOrPullRequestMarkdownIcon, getIssueOrPullRequestThemeIcon } from '../../git/utils/-webview/icons.js';
import type { ViewsWithCommits } from '../viewBase.js';
import type { ClipboardType } from './abstract/viewNode.js';
import { ContextValues, getViewNodeId, ViewNode } from './abstract/viewNode.js';

export class AutolinkedItemNode extends ViewNode<'autolink', ViewsWithCommits> {
	constructor(
		view: ViewsWithCommits,
		protected override readonly parent: ViewNode,
		public readonly repoPath: string,
		public readonly item: Autolink,
		private maybeEnriched: Promise<IssueOrPullRequest | undefined> | IssueOrPullRequest | undefined,
	) {
		super('autolink', GitUri.fromRepoPath(repoPath), view, parent);

		this._uniqueId = getViewNodeId(`${this.type}+${item.id}`, this.context);
	}

	override get id(): string {
		return this._uniqueId;
	}

	override async toClipboard(type?: ClipboardType): Promise<string> {
		const enriched = await this.maybeEnriched;
		switch (type) {
			case 'markdown': {
				return `[${this.item.prefix ?? ''}${this.item.id}](${this.item.url})${
					enriched?.title ? ` - ${enriched?.title}` : ''
				}`;
			}
			default:
				return `${this.item.id}: ${enriched?.title ?? this.item.url}`;
		}
	}

	override getUrl(): string {
		return this.item.url;
	}

	getChildren(): ViewNode[] {
		return [];
	}

	getTreeItem(): TreeItem {
		const enriched = this.maybeEnriched;
		const pending = isPromise(enriched);
		if (pending) {
			void enriched.then(item => {
				this.maybeEnriched = item;
				this.view.triggerNodeChange(this);
			});
		}

		if (pending || enriched == null) {
			const autolink = this.item;
			const { provider } = autolink;

			const item = new TreeItem(
				autolink.description ?? l10n.t('Autolink {0}', `${autolink.prefix}${autolink.id}`),
				TreeItemCollapsibleState.None,
			);
			item.description = provider?.name ?? l10n.t('Custom');
			item.iconPath = new ThemeIcon(
				pending
					? 'loading~spin'
					: autolink.type == null
						? 'link'
						: autolink.type === 'pullrequest'
							? 'git-pull-request'
							: 'issues',
			);
			item.contextValue = ContextValues.AutolinkedItem;

			// The autolink's parts come from settings, a provider, or the commit message, so are escaped
			const url = getMarkdownWebLinkDestination(autolink.url);
			const urlText = escapeMarkdown(autolink.url);
			item.tooltip = new MarkdownString(
				`${
					autolink.description
						? l10n.t('Autolinked {0}', escapeMarkdown(autolink.description))
						: `${
								autolink.type == null
									? l10n.t('Autolinked')
									: autolink.type === 'pullrequest'
										? l10n.t('Autolinked Pull Request')
										: l10n.t('Autolinked Issue')
							} ${escapeMarkdown(`${autolink.prefix}${autolink.id}`)}`
				} \\\n${
					url != null
						? `[${urlText}](${url}${
								autolink.title != null ? ` "${escapeMarkdownLinkTitle(autolink.title)}"` : ''
							})`
						: urlText
				}`,
			);
			return item;
		}

		const relativeTime = fromNow(enriched.closedDate ?? enriched.updatedDate ?? enriched.createdDate);

		const item = new TreeItem(`${enriched.id}: ${enriched.title}`, TreeItemCollapsibleState.None);
		item.description = relativeTime;
		item.iconPath = getIssueOrPullRequestThemeIcon(enriched);
		item.contextValue = `${ContextValues.AutolinkedItem}+${enriched.type === 'pullrequest' ? 'pr' : 'issue'}`;

		const linkId = escapeMarkdownLinkTitle(enriched.id);
		const linkProvider = escapeMarkdownLinkTitle(enriched.provider.name);
		const linkTitle = ` "${
			enriched.type === 'pullrequest'
				? l10n.t('Open Pull Request \\#{0} on {1}', linkId, linkProvider)
				: l10n.t('Open Issue \\#{0} on {1}', linkId, linkProvider)
		}"`;
		const status =
			enriched.state == null
				? ''
				: enriched.closed
					? enriched.state === 'merged'
						? l10n.t('was merged {0}', relativeTime)
						: l10n.t('was closed {0}', relativeTime)
					: enriched.type === 'pullrequest' && isPullRequestInMergeQueue(enriched)
						? formatPullRequestMergeQueueStatus(enriched.mergeQueue)
						: l10n.t('was opened {0}', relativeTime);
		// Emits no `command:` links, so it isn't trusted; the title comes from the provider, so is escaped
		const url = getMarkdownWebLinkDestination(enriched.url);
		const title = `**${escapeMarkdown(enriched.title.trim())}**`;
		const id = `#${escapeMarkdown(enriched.id)}`;
		const tooltip = new MarkdownString(
			url != null
				? `${getIssueOrPullRequestMarkdownIcon(enriched)} [${title}](${url}${linkTitle}) \\\n[${id}](${url}${linkTitle}) ${status}`
				: `${getIssueOrPullRequestMarkdownIcon(enriched)} ${title} \\\n${id} ${status}`,
			true,
		);
		tooltip.supportHtml = true;

		item.tooltip = tooltip;

		return item;
	}
}

// function isIssueOrPullRequest(item: Autolink | IssueOrPullRequest): item is IssueOrPullRequest {
// 	return 'closed' in item && typeof item.closed === 'boolean';
// }
