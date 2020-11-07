'use strict';
import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { MessageNode } from './common';
import { Repository } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { RemoteNode } from './remoteNode';
import { RemotesView } from '../remotesView';
import { RepositoriesView } from '../repositoriesView';
import { RepositoryNode } from './repositoryNode';
import { ContextValues, ViewNode } from './viewNode';
import { debug, gate } from '../../system';

export class RemotesNode extends ViewNode<RemotesView | RepositoriesView> {
	static key = ':remotes';
	static getId(repoPath: string): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}`;
	}

	private _children: ViewNode[] | undefined;

	constructor(uri: GitUri, view: RemotesView | RepositoriesView, parent: ViewNode, public readonly repo: Repository) {
		super(uri, view, parent);
	}

	get id(): string {
		return RemotesNode.getId(this.repo.path);
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this._children == null) {
			const remotes = await this.repo.getRemotes({ sort: true });
			if (remotes == null || remotes.length === 0) {
				return [new MessageNode(this.view, this, 'No remotes could be found')];
			}

			this._children = remotes.map(r => new RemoteNode(this.uri, this.view, this, r, this.repo));
		}

		return this._children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Remotes', TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.contextValue = ContextValues.Remotes;
		item.iconPath = new ThemeIcon('cloud');

		return item;
	}

	@gate()
	@debug()
	refresh() {
		this._children = undefined;
	}
}
