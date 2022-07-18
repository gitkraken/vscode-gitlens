import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import * as nls from 'vscode-nls';
import type { GitUri } from '../../git/gitUri';
import type { Repository } from '../../git/models/repository';
import { gate } from '../../system/decorators/gate';
import { debug } from '../../system/decorators/log';
import { map } from '../../system/iterable';
import type { RepositoriesView } from '../repositoriesView';
import type { StashesView } from '../stashesView';
import { MessageNode } from './common';
import { RepositoryNode } from './repositoryNode';
import { StashNode } from './stashNode';
import { ContextValues, ViewNode } from './viewNode';

const localize = nls.loadMessageBundle();
export class StashesNode extends ViewNode<StashesView | RepositoriesView> {
	static key = ':stashes';
	static getId(repoPath: string): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}`;
	}

	private _children: ViewNode[] | undefined;

	constructor(uri: GitUri, view: StashesView | RepositoriesView, parent: ViewNode, public readonly repo: Repository) {
		super(uri, view, parent);
	}

	override get id(): string {
		return StashesNode.getId(this.repo.path);
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this._children == null) {
			const stash = await this.repo.getStash();
			if (stash == null) {
				return [new MessageNode(this.view, this, localize('noStashesFound', 'No stashes could be found.'))];
			}

			this._children = [...map(stash.commits.values(), c => new StashNode(this.view, this, c))];
		}

		return this._children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(localize('stashes', 'Stashes'), TreeItemCollapsibleState.Collapsed);
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
