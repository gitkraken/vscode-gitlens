import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { GitUri } from '../../git/gitUri';
import type { Repository } from '../../git/models/repository';
import { gate } from '../../system/decorators/gate';
import { debug } from '../../system/decorators/log';
import type { ViewsWithRemotesNode } from '../viewBase';
import { MessageNode } from './common';
import { RemoteNode } from './remoteNode';
import { ContextValues, getViewNodeId, ViewNode } from './viewNode';

export class RemotesNode extends ViewNode<'remotes', ViewsWithRemotesNode> {
	constructor(
		uri: GitUri,
		view: ViewsWithRemotesNode,
		protected override readonly parent: ViewNode,
		public readonly repo: Repository,
	) {
		super('remotes', uri, view, parent);

		this.updateContext({ repository: repo });
		this._uniqueId = getViewNodeId(this.type, this.context);
	}

	override get id(): string {
		return this._uniqueId;
	}

	get repoPath(): string {
		return this.repo.path;
	}

	private _children: ViewNode[] | undefined;

	async getChildren(): Promise<ViewNode[]> {
		if (this._children == null) {
			const remotes = await this.repo.getRemotes({ sort: true });
			if (remotes.length === 0) {
				return [new MessageNode(this.view, this, 'No remotes could be found')];
			}

			this._children = remotes.map(r => new RemoteNode(this.uri, this.view, this, this.repo, r));
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
	override refresh() {
		this._children = undefined;
	}
}
