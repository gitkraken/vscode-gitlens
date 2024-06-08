import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../../git/gitUri';
import type { GitLog } from '../../git/models/log';
import { isPullRequest } from '../../git/models/pullRequest';
import { getSettledValue, pauseOnCancelOrTimeoutMapTuple } from '../../system/promise';
import type { ViewsWithCommits } from '../viewBase';
import { CacheableChildrenViewNode } from './abstract/cacheableChildrenViewNode';
import type { PageableViewNode, ViewNode } from './abstract/viewNode';
import { ContextValues, getViewNodeId } from './abstract/viewNode';
import { AutolinkedItemNode } from './autolinkedItemNode';
import { LoadMoreNode, MessageNode } from './common';
import { PullRequestNode } from './pullRequestNode';

let instanceId = 0;

export class AutolinkedItemsNode extends CacheableChildrenViewNode<'autolinks', ViewsWithCommits> {
	private _instanceId: number;

	constructor(
		view: ViewsWithCommits,
		protected override readonly parent: PageableViewNode,
		public readonly repoPath: string,
		public readonly log: GitLog,
		private expand: boolean,
	) {
		super('autolinks', GitUri.fromRepoPath(repoPath), view, parent);

		this._instanceId = instanceId++;
		this.updateContext({ autolinksId: String(this._instanceId) });
		this._uniqueId = getViewNodeId(this.type, this.context);
	}

	override get id(): string {
		return this._uniqueId;
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this.children == null) {
			const commits = [...this.log.commits.values()];

			let children: ViewNode[] | undefined;
			if (commits.length) {
				const remote = await this.view.container.git.getBestRemoteWithProvider(this.repoPath);
				const combineMessages = commits.map(c => c.message).join('\n');

				const [enrichedAutolinksResult /*, ...prsResults*/] = await Promise.allSettled([
					this.view.container.autolinks
						.getEnrichedAutolinks(combineMessages, remote)
						.then(enriched =>
							enriched != null ? pauseOnCancelOrTimeoutMapTuple(enriched, undefined, 250) : undefined,
						),
					// Only get PRs from the first 100 commits to attempt to avoid hitting the api limits
					// ...commits.slice(0, 100).map(c => this.remote.provider.getPullRequestForCommit(c.sha)),
				]);

				const enrichedAutolinks = getSettledValue(enrichedAutolinksResult);

				// for (const result of prsResults) {
				// 	if (result.status !== 'fulfilled' || result.value == null) continue;

				// 	items.set(result.value.id, result.value);
				// }

				if (enrichedAutolinks?.size) {
					children = [...enrichedAutolinks.values()].map(([issueOrPullRequest, autolink]) =>
						issueOrPullRequest != null && isPullRequest(issueOrPullRequest?.value)
							? new PullRequestNode(this.view, this, issueOrPullRequest.value, this.log.repoPath)
							: new AutolinkedItemNode(
									this.view,
									this,
									this.repoPath,
									autolink,
									issueOrPullRequest?.value,
							  ),
					);
				}
			}

			if (!children?.length) {
				children = [new MessageNode(this.view, this, 'No autolinked issues or pull requests could be found.')];
			}

			if (this.log.hasMore) {
				children.push(
					new LoadMoreNode(this.view, this.parent, children[children.length - 1], {
						context: { expandAutolinks: true },
						message: 'Load more commits to search for autolinks',
					}),
				);
			}

			this.children = children;
		}
		return this.children;
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
}
