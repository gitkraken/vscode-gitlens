import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { GitUri } from '../../git/gitUri';
import type { GitReflog } from '../../git/models/reflog';
import type { Repository } from '../../git/models/repository';
import { gate } from '../../system/decorators/gate';
import { debug } from '../../system/decorators/log';
import type { RepositoriesView } from '../repositoriesView';
import type { WorkspacesView } from '../workspacesView';
import { LoadMoreNode, MessageNode } from './common';
import { ReflogRecordNode } from './reflogRecordNode';
import { RepositoryNode } from './repositoryNode';
import type { PageableViewNode } from './viewNode';
import { ContextValues, ViewNode } from './viewNode';

export class ReflogNode extends ViewNode<RepositoriesView | WorkspacesView> implements PageableViewNode {
	static key = ':reflog';
	static getId(repoPath: string, workspaceId?: string): string {
		return `${RepositoryNode.getId(repoPath, workspaceId)}${this.key}`;
	}

	private _children: ViewNode[] | undefined;

	constructor(
		uri: GitUri,
		view: RepositoriesView | WorkspacesView,
		parent: ViewNode,
		public readonly repo: Repository,
		private readonly options?: {
			workspaceId?: string;
		},
	) {
		super(uri, view, parent);
	}

	override get id(): string {
		return ReflogNode.getId(this.repo.path, this.options?.workspaceId);
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this._children === undefined) {
			const children = [];

			const reflog = await this.getReflog();
			if (reflog === undefined || reflog.records.length === 0) {
				return [new MessageNode(this.view, this, 'No activity could be found.')];
			}

			children.push(...reflog.records.map(r => new ReflogRecordNode(this.view, this, r)));

			if (reflog.hasMore) {
				children.push(new LoadMoreNode(this.view, this, children[children.length - 1]));
			}

			this._children = children;
		}
		return this._children;
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

	@gate()
	@debug()
	override refresh(reset?: boolean) {
		this._children = undefined;
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

	limit: number | undefined = this.view.getNodeLastKnownLimit(this);
	async loadMore(limit?: number) {
		let reflog = await this.getReflog();
		if (reflog === undefined || !reflog.hasMore) return;

		reflog = await reflog.more?.(limit ?? this.view.config.pageItemLimit);
		if (this._reflog === reflog) return;

		this._reflog = reflog;
		this.limit = reflog?.count;
		void this.triggerChange(false);
	}
}
