import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { GitUri } from '../../git/gitUri';
import type { GitReflog } from '../../git/models/reflog';
import type { Repository } from '../../git/models/repository';
import { debug } from '../../system/decorators/log';
import type { RepositoriesView } from '../repositoriesView';
import type { WorkspacesView } from '../workspacesView';
import { CacheableChildrenViewNode } from './abstract/cacheableChildrenViewNode';
import type { PageableViewNode, ViewNode } from './abstract/viewNode';
import { ContextValues, getViewNodeId } from './abstract/viewNode';
import { LoadMoreNode, MessageNode } from './common';
import { ReflogRecordNode } from './reflogRecordNode';

export class ReflogNode
	extends CacheableChildrenViewNode<'reflog', RepositoriesView | WorkspacesView>
	implements PageableViewNode
{
	limit: number | undefined;

	constructor(
		uri: GitUri,
		view: RepositoriesView | WorkspacesView,
		parent: ViewNode,
		public readonly repo: Repository,
	) {
		super('reflog', uri, view, parent);

		this.updateContext({ repository: repo });
		this._uniqueId = getViewNodeId(this.type, this.context);
		this.limit = this.view.getNodeLastKnownLimit(this);
	}

	override get id(): string {
		return this._uniqueId;
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this.children === undefined) {
			const children = [];

			const reflog = await this.getReflog();
			if (reflog === undefined || reflog.records.length === 0) {
				return [new MessageNode(this.view, this, 'No activity could be found.')];
			}

			children.push(...reflog.records.map(r => new ReflogRecordNode(this.view, this, r)));

			if (reflog.hasMore) {
				children.push(new LoadMoreNode(this.view, this, children[children.length - 1]));
			}

			this.children = children;
		}
		return this.children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Incoming Activity', TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.contextValue = ContextValues.Reflog;
		item.description = 'experimental';
		item.iconPath = {
			dark: this.view.container.context.asAbsolutePath('images/dark/icon-activity.svg'),
			light: this.view.container.context.asAbsolutePath('images/light/icon-activity.svg'),
		};

		return item;
	}

	@debug()
	override refresh(reset?: boolean) {
		super.refresh(true);

		if (reset) {
			this._reflog = undefined;
		}
	}

	private _reflog: GitReflog | undefined;
	private async getReflog() {
		if (this._reflog === undefined) {
			this._reflog = await this.view.container.git.getIncomingActivity(this.repo.path, {
				all: true,
				limit: this.limit ?? this.view.config.defaultItemLimit,
			});
		}

		return this._reflog;
	}

	get hasMore() {
		return this._reflog?.hasMore ?? true;
	}

	async loadMore(limit?: number) {
		let reflog = await this.getReflog();
		if (!reflog?.hasMore) return;

		reflog = await reflog.more?.(limit ?? this.view.config.pageItemLimit);
		if (this._reflog === reflog) return;

		this._reflog = reflog;
		this.limit = reflog?.count;
		void this.triggerChange(false);
	}
}
