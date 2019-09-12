'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Container } from '../../container';
import { GitUri, Repository } from '../../git/gitService';
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

	readonly supportsPaging = true;
	readonly rememberLastMaxCount = true;
	maxCount: number | undefined = this.view.getNodeLastMaxCount(this);

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

			const reflog = await Container.git.getIncomingActivity(this.repo.path, {
				all: true,
				maxCount: this.maxCount !== undefined ? this.maxCount : this.view.config.defaultItemLimit
			});
			if (reflog === undefined || reflog.records.length === 0) {
				return [new MessageNode(this.view, this, 'No activity could be found.')];
			}

			children.push(...reflog.records.map(r => new ReflogRecordNode(this.view, this, r)));

			if (reflog.truncated) {
				children.push(
					new ShowMoreNode(this.view, this, 'Activity', reflog.maxCount, children[children.length - 1])
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
	refresh() {
		this._children = undefined;
	}
}
