import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { GitUri } from '../../git/gitUri';
import type { Repository } from '../../git/models/repository';
import { gate } from '../../system/decorators/gate';
import { debug } from '../../system/decorators/log';
import { map } from '../../system/iterable';
import type { ViewsWithStashesNode } from '../viewBase';
import { MessageNode } from './common';
import { RepositoryNode } from './repositoryNode';
import { StashNode } from './stashNode';
import { ContextValues, ViewNode } from './viewNode';

export class StashesNode extends ViewNode<ViewsWithStashesNode> {
	static key = ':stashes';
	static getId(repoPath: string, workspaceId?: string): string {
		return `${RepositoryNode.getId(repoPath, workspaceId)}${this.key}`;
	}

	private _children: ViewNode[] | undefined;

	constructor(
		uri: GitUri,
		view: ViewsWithStashesNode,
		parent: ViewNode,
		public readonly repo: Repository,
		private readonly options?: {
			workspaceId?: string;
		},
	) {
		super(uri, view, parent);
	}

	override get id(): string {
		return StashesNode.getId(this.repo.path, this.options?.workspaceId);
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this._children == null) {
			const stash = await this.repo.getStash();
			if (stash == null) return [new MessageNode(this.view, this, 'No stashes could be found.')];

			this._children = [
				...map(
					stash.commits.values(),
					c => new StashNode(this.view, this, c, { workspaceId: this.options?.workspaceId }),
				),
			];
		}

		return this._children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Stashes', TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.contextValue = ContextValues.Stashes;
		item.iconPath = new ThemeIcon('gitlens-stashes');
		return item;
	}

	@gate()
	@debug()
	override refresh() {
		this._children = undefined;
	}
}
