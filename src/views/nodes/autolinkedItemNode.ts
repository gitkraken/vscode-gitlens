import { MarkdownString, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { Autolink } from '../../annotations/autolinks';
import { GitUri } from '../../git/gitUri';
import type { IssueOrPullRequest } from '../../git/models/issue';
import { getIssueOrPullRequestMarkdownIcon, getIssueOrPullRequestThemeIcon } from '../../git/models/issue';
import { fromNow } from '../../system/date';
import { isPromise } from '../../system/promise';
import type { ViewsWithCommits } from '../viewBase';
import { ContextValues, getViewNodeId, ViewNode } from './viewNode';

export class AutolinkedItemNode extends ViewNode<ViewsWithCommits> {
	constructor(
		view: ViewsWithCommits,
		protected override readonly parent: ViewNode,
		public readonly repoPath: string,
		public readonly item: Autolink,
		private enrichedItem: Promise<IssueOrPullRequest | undefined> | IssueOrPullRequest | undefined,
	) {
		super(GitUri.fromRepoPath(repoPath), view, parent);

		this._uniqueId = getViewNodeId(`autolink+${item.id}`, this.context);
	}

	override get id(): string {
		return this._uniqueId;
	}

	override toClipboard(): string {
		return this.item.url;
	}

	getChildren(): ViewNode[] {
		return [];
	}

	getTreeItem(): TreeItem {
		const enriched = this.enrichedItem;
		const pending = isPromise(enriched);
		if (pending) {
			void enriched.then(item => {
				this.enrichedItem = item;
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

		const relativeTime = fromNow(enriched.closedDate ?? enriched.date);

		const item = new TreeItem(`${enriched.id}: ${enriched.title}`, TreeItemCollapsibleState.None);
		item.description = relativeTime;
		item.iconPath = getIssueOrPullRequestThemeIcon(enriched);
		item.contextValue = enriched.type === 'pullrequest' ? ContextValues.PullRequest : ContextValues.AutolinkedIssue;

		const linkTitle = ` "Open ${enriched.type === 'pullrequest' ? 'Pull Request' : 'Issue'} \\#${enriched.id} on ${
			enriched.provider.name
		}"`;
		const tooltip = new MarkdownString(
			`${getIssueOrPullRequestMarkdownIcon(enriched)} [**${enriched.title.trim()}**](${
				enriched.url
			}${linkTitle}) \\\n[#${enriched.id}](${enriched.url}${linkTitle}) was ${
				enriched.closed ? 'closed' : 'opened'
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
