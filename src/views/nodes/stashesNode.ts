'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Container } from '../../container';
import { Repository } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { Iterables } from '../../system';
import { ViewsWithFiles } from '../viewBase';
import { MessageNode } from './common';
import { StashNode } from './stashNode';
import { ContextValues, ViewNode } from './viewNode';
import { RepositoryNode } from './repositoryNode';

export class StashesNode extends ViewNode<ViewsWithFiles> {
	static key = ':stashes';
	static getId(repoPath: string): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}`;
	}

	constructor(uri: GitUri, view: ViewsWithFiles, parent: ViewNode, public readonly repo: Repository) {
		super(uri, view, parent);
	}

	get id(): string {
		return StashesNode.getId(this.repo.path);
	}

	async getChildren(): Promise<ViewNode[]> {
		const stash = await this.repo.getStashList();
		if (stash === undefined) return [new MessageNode(this.view, this, 'No stashes could be found.')];

		return [...Iterables.map(stash.commits.values(), c => new StashNode(this.view, this, c))];
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Stashes', TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.contextValue = ContextValues.Stashes;

		item.iconPath = {
			dark: Container.context.asAbsolutePath('images/dark/icon-stash.svg'),
			light: Container.context.asAbsolutePath('images/light/icon-stash.svg'),
		};

		return item;
	}
}
