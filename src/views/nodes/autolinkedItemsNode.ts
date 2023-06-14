import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { Autolink } from '../../annotations/autolinks';
import { GitUri } from '../../git/gitUri';
import type { IssueOrPullRequest } from '../../git/models/issue';
import type { GitLog } from '../../git/models/log';
import { PullRequest } from '../../git/models/pullRequest';
import { gate } from '../../system/decorators/gate';
import { debug } from '../../system/decorators/log';
import { union } from '../../system/iterable';
import type { ViewsWithCommits } from '../viewBase';
import { AutolinkedItemNode } from './autolinkedItemNode';
import { LoadMoreNode, MessageNode } from './common';
import { PullRequestNode } from './pullRequestNode';
import { ContextValues, getViewNodeId, ViewNode } from './viewNode';

let instanceId = 0;

export class AutolinkedItemsNode extends ViewNode<ViewsWithCommits> {
	private _instanceId: number;

	constructor(
		view: ViewsWithCommits,
		protected override readonly parent: ViewNode,
		public readonly repoPath: string,
		public readonly log: GitLog,
		private expand: boolean,
	) {
		super(GitUri.fromRepoPath(repoPath), view, parent);

		this._instanceId = instanceId++;
		this.updateContext({ autolinksId: String(this._instanceId) });
		this._uniqueId = getViewNodeId('autolinks', this.context);
	}

	override get id(): string {
		return this._uniqueId;
	}

	private _children: ViewNode[] | undefined;

	async getChildren(): Promise<ViewNode[]> {
		if (this._children == null) {
			const commits = [...this.log.commits.values()];

			let children: ViewNode[] | undefined;
			if (commits.length) {
				const combineMessages = commits.map(c => c.message).join('\n');

				let items: Map<string, Autolink | IssueOrPullRequest | PullRequest>;

				const customAutolinks = this.view.container.autolinks.getAutolinks(combineMessages);

				const remote = await this.view.container.git.getBestRemoteWithProvider(this.repoPath);
				if (remote != null) {
					const providerAutolinks = this.view.container.autolinks.getAutolinks(combineMessages, remote);

					items = providerAutolinks;

					const [autolinkedMapResult /*, ...prsResults*/] = await Promise.allSettled([
						this.view.container.autolinks.getLinkedIssuesAndPullRequests(combineMessages, remote, {
							autolinks: providerAutolinks,
						}),
						// Only get PRs from the first 100 commits to attempt to avoid hitting the api limits
						// ...commits.slice(0, 100).map(c => this.remote.provider.getPullRequestForCommit(c.sha)),
					]);

					if (autolinkedMapResult.status === 'fulfilled' && autolinkedMapResult.value != null) {
						for (const [id, issue] of autolinkedMapResult.value) {
							items.set(id, issue);
						}
					}

					items = new Map(union(items, customAutolinks));
				} else {
					items = customAutolinks;
				}

				// for (const result of prsResults) {
				// 	if (result.status !== 'fulfilled' || result.value == null) continue;

				// 	items.set(result.value.id, result.value);
				// }

				children = [...items.values()].map(item =>
					PullRequest.is(item)
						? new PullRequestNode(this.view, this, item, this.log.repoPath)
						: new AutolinkedItemNode(this.view, this, this.repoPath, item),
				);
			}

			if (children == null || children.length === 0) {
				children = [new MessageNode(this.view, this, 'No autolinked issues or pull requests could be found.')];
			}

			if (this.log.hasMore) {
				children.push(
					new LoadMoreNode(this.view, this.parent as any, children[children.length - 1], {
						context: { expandAutolinks: true },
						message: 'Load more commits to search for autolinks',
					}),
				);
			}

			this._children = children;
		}
		return this._children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(
			'Autolinked Issues and Pull Requests',
			this.expand ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed,
		);
		item.id = this.id;
		item.contextValue = ContextValues.AutolinkedItems;

		return item;
	}

	@gate()
	@debug()
	override refresh(reset: boolean = false) {
		if (!reset) return;

		this._children = undefined;
	}
}
