import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { GitUri } from '../../git/gitUri';
import type { Repository } from '../../git/models/repository';
import { debug } from '../../system/decorators/log';
import { map } from '../../system/iterable';
import type { ViewsWithStashesNode } from '../viewBase';
import { CacheableChildrenViewNode } from './abstract/cacheableChildrenViewNode';
import type { ViewNode } from './abstract/viewNode';
import { ContextValues, getViewNodeId } from './abstract/viewNode';
import { MessageNode } from './common';
import { StashNode } from './stashNode';

export class StashesNode extends CacheableChildrenViewNode<'stashes', ViewsWithStashesNode> {
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

	async getChildren(): Promise<ViewNode[]> {
		if (this.children == null) {
			const gitStash = await this.repo.git.getStash();
			if (gitStash == null) return [new MessageNode(this.view, this, 'No stashes could be found.')];

			this.children = [...map(gitStash.stashes.values(), c => new StashNode(this.view, this, c))];
		}

		return this.children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Stashes', TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.contextValue = ContextValues.Stashes;
		item.iconPath = new ThemeIcon('gitlens-stashes');
		return item;
	}

	@debug()
	override refresh() {
		super.refresh(true);
	}
}
