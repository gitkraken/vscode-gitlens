import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import * as nls from 'vscode-nls';
import type { GitUri } from '../../git/gitUri';
import type { Repository } from '../../git/models/repository';
import { gate } from '../../system/decorators/gate';
import { debug } from '../../system/decorators/log';
import type { RemotesView } from '../remotesView';
import type { RepositoriesView } from '../repositoriesView';
import { MessageNode } from './common';
import { RemoteNode } from './remoteNode';
import { RepositoryNode } from './repositoryNode';
import { ContextValues, ViewNode } from './viewNode';

const localize = nls.loadMessageBundle();
export class RemotesNode extends ViewNode<RemotesView | RepositoriesView> {
	static key = ':remotes';
	static getId(repoPath: string): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}`;
	}

	private _children: ViewNode[] | undefined;

	constructor(uri: GitUri, view: RemotesView | RepositoriesView, parent: ViewNode, public readonly repo: Repository) {
		super(uri, view, parent);
	}

	override get id(): string {
		return RemotesNode.getId(this.repo.path);
	}

	get repoPath(): string {
		return this.repo.path;
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this._children == null) {
			const remotes = await this.repo.getRemotes({ sort: true });
			if (remotes.length === 0) {
				return [new MessageNode(this.view, this, localize('noRemotesFound', 'No remotes could be found'))];
			}

			this._children = remotes.map(r => new RemoteNode(this.uri, this.view, this, r, this.repo));
		}

		return this._children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(localize('remotes', 'Remotes'), TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.contextValue = ContextValues.Remotes;
		item.iconPath = new ThemeIcon('cloud');

		return item;
	}

	@gate()
	@debug()
	override refresh() {
		this._children = undefined;
	}
}
