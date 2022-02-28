import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../../git/gitUri';
import { GitFile, GitLog, GitRemote, IssueOrPullRequest, PullRequest } from '../../git/models';
import { RichRemoteProvider } from '../../git/remotes/provider';
import { gate } from '../../system/decorators/gate';
import { debug } from '../../system/decorators/log';
import { PromiseCancelledErrorWithId } from '../../system/promise';
import { ViewsWithCommits } from '../viewBase';
import { AutolinkedItemNode } from './autolinkedItemNode';
import { LoadMoreNode, MessageNode } from './common';
import { PullRequestNode } from './pullRequestNode';
import { ContextValues, ViewNode } from './viewNode';

export interface FilesQueryResults {
	label: string;
	files: GitFile[] | undefined;
	filtered?: {
		filter: 'left' | 'right';
		files: GitFile[];
	};
}

let instanceId = 0;

export class AutolinkedItemsNode extends ViewNode<ViewsWithCommits> {
	private _children: ViewNode[] | undefined;
	private _instanceId: number;

	constructor(
		view: ViewsWithCommits,
		parent: ViewNode,
		public readonly repoPath: string,
		public readonly remote: GitRemote<RichRemoteProvider>,
		public readonly log: GitLog,
		private expand: boolean,
	) {
		super(GitUri.fromRepoPath(repoPath), view, parent);
		this._instanceId = instanceId++;
	}

	override get id(): string {
		return `${this.parent!.id}:results:autolinked:${this._instanceId}`;
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this._children == null) {
			const commits = [...this.log.commits.values()];

			let children: ViewNode[] | undefined;
			if (commits.length) {
				const combineMessages = commits.map(c => c.message).join('\n');

				const [autolinkedMapResult /*, ...prsResults*/] = await Promise.allSettled([
					this.view.container.autolinks.getIssueOrPullRequestLinks(combineMessages, this.remote),
					// Only get PRs from the first 100 commits to attempt to avoid hitting the api limits
					// ...commits.slice(0, 100).map(c => this.remote.provider.getPullRequestForCommit(c.sha)),
				]);

				const items = new Map<string, IssueOrPullRequest | PullRequest>();

				if (autolinkedMapResult.status === 'fulfilled' && autolinkedMapResult.value != null) {
					for (const [id, issue] of autolinkedMapResult.value) {
						if (issue == null || issue instanceof PromiseCancelledErrorWithId) continue;

						items.set(id, issue);
					}
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
