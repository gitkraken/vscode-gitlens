import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { GitUri } from '../../git/gitUri';
import type { Repository } from '../../git/models/repository';
import { gate } from '../../system/decorators/gate';
import { debug } from '../../system/decorators/log';
import { map } from '../../system/iterable';
import type { ViewsWithStashesNode } from '../viewBase';
import { MessageNode } from './common';
import { StashNode } from './stashNode';
import { ContextValues, getViewNodeId, ViewNode } from './viewNode';

export class StashesNode extends ViewNode<'stashes', ViewsWithStashesNode> {
	constructor(
		uri: GitUri,
		view: ViewsWithStashesNode,
		protected override parent: ViewNode,
		public readonly repo: Repository,
	) {
		super('stashes', uri, view, parent);

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
			const stash = await this.repo.getStash();
			if (stash == null) return [new MessageNode(this.view, this, 'No stashes could be found.')];

			this._children = [...map(stash.commits.values(), c => new StashNode(this.view, this, c))];
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
