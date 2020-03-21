'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ViewBranchesLayout } from '../../configuration';
import { Container } from '../../container';
import { GitUri, Repository } from '../../git/gitService';
import { Arrays, debug, gate } from '../../system';
import { RepositoriesView } from '../repositoriesView';
import { BranchNode } from './branchNode';
import { BranchOrTagFolderNode } from './branchOrTagFolderNode';
import { ResourceType, ViewNode } from './viewNode';
import { RepositoryNode } from './repositoryNode';
import { MessageNode } from './common';

export class BranchesNode extends ViewNode<RepositoriesView> {
	static key = ':branches';
	static getId(repoPath: string): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}`;
	}

	private _children: ViewNode[] | undefined;

	constructor(uri: GitUri, view: RepositoriesView, parent: ViewNode, public readonly repo: Repository) {
		super(uri, view, parent);
	}

	get id(): string {
		return BranchesNode.getId(this.repo.path);
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this._children === undefined) {
			const branches = await this.repo.getBranches({
				// only show local branches
				filter: b => !b.remote,
				sort: true,
			});
			if (branches.length === 0) return [new MessageNode(this.view, this, 'No branches could be found.')];

			const branchNodes = branches.map(b => new BranchNode(this.uri, this.view, this, b));
			if (this.view.config.branches.layout === ViewBranchesLayout.List) return branchNodes;

			const hierarchy = Arrays.makeHierarchical(
				branchNodes,
				n => n.treeHierarchy,
				(...paths) => paths.join('/'),
				this.view.config.files.compact,
				b => {
					b.compacted = true;
					return true;
				},
			);

			const root = new BranchOrTagFolderNode(
				this.view,
				this,
				'branch',
				this.repo.path,
				'',
				undefined,
				hierarchy,
				'branches',
			);
			this._children = root.getChildren();
		}
		return this._children;
	}

	async getTreeItem(): Promise<TreeItem> {
		const item = new TreeItem('Branches', TreeItemCollapsibleState.Collapsed);
		item.contextValue = ResourceType.Branches;
		if (await this.repo.hasRemotes()) {
			item.contextValue += '+remotes';
		}
		item.iconPath = {
			dark: Container.context.asAbsolutePath('images/dark/icon-branch.svg'),
			light: Container.context.asAbsolutePath('images/light/icon-branch.svg'),
		};
		item.id = this.id;

		return item;
	}

	@gate()
	@debug()
	refresh() {
		this._children = undefined;
	}
}
