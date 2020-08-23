'use strict';
import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { BranchOrTagFolderNode } from './branchOrTagFolderNode';
import { MessageNode } from './common';
import { ViewBranchesLayout } from '../../configuration';
import { Repository } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { RepositoriesView } from '../repositoriesView';
import { RepositoryNode } from './repositoryNode';
import { Arrays } from '../../system';
import { TagNode } from './tagNode';
import { TagsView } from '../tagsView';
import { ContextValues, ViewNode } from './viewNode';

export class TagsNode extends ViewNode<TagsView | RepositoriesView> {
	static key = ':tags';
	static getId(repoPath: string): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}`;
	}

	constructor(uri: GitUri, view: TagsView | RepositoriesView, parent: ViewNode, public readonly repo: Repository) {
		super(uri, view, parent);
	}

	get id(): string {
		return TagsNode.getId(this.repo.path);
	}

	async getChildren(): Promise<ViewNode[]> {
		const tags = await this.repo.getTags({ sort: true });
		if (tags.length === 0) return [new MessageNode(this.view, this, 'No tags could be found.')];

		const tagNodes = tags.map(t => new TagNode(GitUri.fromRepoPath(this.uri.repoPath!, t.ref), this.view, this, t));
		if (this.view.config.branches.layout === ViewBranchesLayout.List) return tagNodes;

		const hierarchy = Arrays.makeHierarchical(
			tagNodes,
			n => n.tag.name.split('/'),
			(...paths) => paths.join('/'),
			this.view.config.files.compact,
		);

		const root = new BranchOrTagFolderNode(
			this.view,
			this,
			'tag',
			this.repo.path,
			'',
			undefined,
			hierarchy,
			'tags',
		);
		const children = root.getChildren();
		return children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Tags', TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.contextValue = ContextValues.Tags;
		item.iconPath = new ThemeIcon('tag');
		return item;
	}
}
