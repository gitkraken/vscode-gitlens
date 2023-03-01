import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ViewBranchesLayout } from '../../config';
import { GitUri } from '../../git/gitUri';
import type { Repository } from '../../git/models/repository';
import { makeHierarchical } from '../../system/array';
import { gate } from '../../system/decorators/gate';
import { debug } from '../../system/decorators/log';
import type { BranchesView } from '../branchesView';
import { RepositoriesView } from '../repositoriesView';
import { BranchNode } from './branchNode';
import { BranchOrTagFolderNode } from './branchOrTagFolderNode';
import { MessageNode } from './common';
import { RepositoryNode } from './repositoryNode';
import { ContextValues, ViewNode } from './viewNode';

export class BranchesNode extends ViewNode<BranchesView | RepositoriesView> {
	static key = ':branches';
	static getId(repoPath: string): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}`;
	}

	private _children: ViewNode[] | undefined;

	constructor(
		uri: GitUri,
		view: BranchesView | RepositoriesView,
		parent: ViewNode,
		public readonly repo: Repository,
	) {
		super(uri, view, parent);
	}

	override get id(): string {
		return BranchesNode.getId(this.repo.path);
	}

	get repoPath(): string {
		return this.repo.path;
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this._children == null) {
			const branches = await this.repo.getBranches({
				// only show local branches
				filter: b => !b.remote,
				sort: { current: false },
			});
			if (branches.values.length === 0) return [new MessageNode(this.view, this, 'No branches could be found.')];

			// TODO@eamodio handle paging
			const branchNodes = branches.values.map(
				b =>
					new BranchNode(GitUri.fromRepoPath(this.uri.repoPath!, b.ref), this.view, this, b, false, {
						showComparison:
							this.view instanceof RepositoriesView
								? this.view.config.branches.showBranchComparison
								: this.view.config.showBranchComparison,
					}),
			);
			if (this.view.config.branches.layout === ViewBranchesLayout.List) return branchNodes;

			const hierarchy = makeHierarchical(
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
		item.id = this.id;
		item.contextValue = ContextValues.Branches;
		if (await this.repo.hasRemotes()) {
			item.contextValue += '+remotes';
		}
		item.iconPath = new ThemeIcon('git-branch');

		return item;
	}

	@gate()
	@debug()
	override refresh() {
		this._children = undefined;
	}
}
