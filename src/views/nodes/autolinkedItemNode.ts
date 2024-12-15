import { MarkdownString, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { Autolink } from '../../autolinks';
import { GitUri } from '../../git/gitUri';
import type { IssueOrPullRequest } from '../../git/models/issue';
import { getIssueOrPullRequestMarkdownIcon, getIssueOrPullRequestThemeIcon } from '../../git/utils/icons';
import { fromNow } from '../../system/date';
import { isPromise } from '../../system/promise';
import type { ViewsWithCommits } from '../viewBase';
import type { ClipboardType } from './abstract/viewNode';
import { ContextValues, getViewNodeId, ViewNode } from './abstract/viewNode';

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
				autolink.description ?? `Autolink ${autolink.prefix}${autolink.id}`,
				TreeItemCollapsibleState.None,
			);
			item.description = provider?.name ?? 'Custom';
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
			item.tooltip = new MarkdownString(
				`${
					autolink.description
						? `Autolinked ${autolink.description}`
						: `${
								autolink.type == null
									? 'Autolinked'
									: autolink.type === 'pullrequest'
									  ? 'Autolinked Pull Request'
									  : 'Autolinked Issue'
						  } ${autolink.prefix}${autolink.id}`
				} \\\n[${autolink.url}](${autolink.url}${autolink.title != null ? ` "${autolink.title}"` : ''})`,
			);
			return item;
		}

		const relativeTime = fromNow(enriched.closedDate ?? enriched.updatedDate ?? enriched.createdDate);

		const item = new TreeItem(`${enriched.id}: ${enriched.title}`, TreeItemCollapsibleState.None);
		item.description = relativeTime;
		item.iconPath = getIssueOrPullRequestThemeIcon(enriched);
		item.contextValue = `${ContextValues.AutolinkedItem}+${enriched.type === 'pullrequest' ? 'pr' : 'issue'}`;

		const linkTitle = ` "Open ${enriched.type === 'pullrequest' ? 'Pull Request' : 'Issue'} \\#${enriched.id} on ${
			enriched.provider.name
		}"`;
		const tooltip = new MarkdownString(
			`${getIssueOrPullRequestMarkdownIcon(enriched)} [**${enriched.title.trim()}**](${
				enriched.url
			}${linkTitle}) \\\n[#${enriched.id}](${enriched.url}${linkTitle}) was ${
				enriched.closed ? (enriched.state === 'merged' ? 'merged' : 'closed') : 'opened'
			} ${relativeTime}`,
			true,
		);
		tooltip.supportHtml = true;
		tooltip.isTrusted = true;

		item.tooltip = tooltip;

		return item;
	}
}

// function isIssueOrPullRequest(item: Autolink | IssueOrPullRequest): item is IssueOrPullRequest {
// 	return 'closed' in item && typeof item.closed === 'boolean';
// }
