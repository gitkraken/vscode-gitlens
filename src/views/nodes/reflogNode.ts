'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Container } from '../../container';
import { GitReflog, GitUri, Repository } from '../../git/gitService';
import { PageableViewNode, ResourceType, ViewNode } from './viewNode';
import { RepositoriesView } from '../repositoriesView';
import { ReflogRecordNode } from './reflogRecordNode';
import { debug, gate } from '../../system';
import { MessageNode, ShowMoreNode } from './common';
import { RepositoryNode } from './repositoryNode';

export class ReflogNode extends ViewNode<RepositoriesView> implements PageableViewNode {
	static key = ':reflog';
	static getId(repoPath: string): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}`;
	}

	private _children: ViewNode[] | undefined;

	constructor(uri: GitUri, view: RepositoriesView, parent: ViewNode, public readonly repo: Repository) {
		super(uri, view, parent);
	}

	get id(): string {
		return ReflogNode.getId(this.repo.path);
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
				children.push(
					new ShowMoreNode(this.view, this, 'Activity', children[children.length - 1])
				);
			}

			this._children = children;
		}
		return this._children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Incoming Activity', TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.contextValue = ResourceType.Reflog;
		item.description = 'experimental';
		item.iconPath = {
			dark: Container.context.asAbsolutePath('images/dark/icon-activity.svg'),
			light: Container.context.asAbsolutePath('images/light/icon-activity.svg')
		};

		return item;
	}

	@gate()
	@debug()
	refresh(reset?: boolean) {
		this._children = undefined;
		if (reset) {
			this._reflog = undefined;
		}
	}

	private _reflog: GitReflog | undefined;
	private async getReflog() {
		if (this._reflog === undefined) {
			this._reflog = await Container.git.getIncomingActivity(this.repo.path, {
				all: true,
				limit: this.view.config.defaultItemLimit
			});
		}

		return this._reflog;
	}

	get hasMore() {
		return this._reflog?.hasMore ?? true;
	}

	async showMore(limit?: number) {
		let reflog = await this.getReflog();
		if (reflog === undefined || !reflog.hasMore) return;

		reflog = await reflog.more?.(limit ?? this.view.config.pageItemLimit);
		if (this._reflog === reflog) return;

		this._reflog = reflog;
		this.triggerChange(false);
	}
}
