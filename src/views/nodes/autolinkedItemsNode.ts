import { Disposable, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../../git/gitUri.js';
import type { GitLog } from '../../git/models/log.js';
import { isPullRequest } from '../../git/models/pullRequest.js';
import { trace } from '../../system/decorators/log.js';
import { weakEvent } from '../../system/event.js';
import { debounce } from '../../system/function/debounce.js';
import { getSettledValue, pauseOnCancelOrTimeoutMapTuple } from '../../system/promise.js';
import type { ViewsWithCommits } from '../viewBase.js';
import { SubscribeableViewNode } from './abstract/subscribeableViewNode.js';
import type { PageableViewNode, ViewNode } from './abstract/viewNode.js';
import { ContextValues, getViewNodeId } from './abstract/viewNode.js';
import { AutolinkedItemNode } from './autolinkedItemNode.js';
import { LoadMoreNode, MessageNode } from './common.js';
import { PullRequestNode } from './pullRequestNode.js';

export class AutolinkedItemsNode extends SubscribeableViewNode<'autolinks', ViewsWithCommits> {
	constructor(
		view: ViewsWithCommits,
		protected override readonly parent: PageableViewNode,
		public readonly repoPath: string,
		public readonly log: GitLog,
		private expand: boolean,
	) {
		super('autolinks', GitUri.fromRepoPath(repoPath), view, parent);

		this._uniqueId = getViewNodeId(this.type, this.context);
	}

	protected override etag(): number {
		return 0;
	}

	override get id(): string {
		return this._uniqueId;
	}

	@trace()
	protected override subscribe(): Disposable | Promise<Disposable | undefined> | undefined {
		return Disposable.from(
			weakEvent(
				this.view.container.integrations.onDidChangeConnectionState,
				debounce(this.onIntegrationsChanged, 500),
				this,
			),
		);
	}

	private onIntegrationsChanged() {
		this.view.triggerNodeChange(this.parent);
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this.children == null) {
			const commits = [...this.log.commits.values()];

			let children: ViewNode[] | undefined;
			if (commits.length) {
				const remote = await this.view.container.git
					.getRepositoryService(this.repoPath)
					.remotes.getBestRemoteWithProvider();
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
					children = Array.from(enrichedAutolinks.values(), ([issueOrPullRequest, autolink]) =>
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
					new LoadMoreNode(this.view, this.parent, children.at(-1)!, {
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
