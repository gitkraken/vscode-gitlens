import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../../git/gitUri';
import type { Repository } from '../../git/models/repository';
import { getOpenedWorktreesByBranch } from '../../git/models/worktree';
import { makeHierarchical } from '../../system/array';
import { debug } from '../../system/decorators/log';
import type { ViewsWithBranchesNode } from '../viewBase';
import { CacheableChildrenViewNode } from './abstract/cacheableChildrenViewNode';
import type { ViewNode } from './abstract/viewNode';
import { ContextValues, getViewNodeId } from './abstract/viewNode';
import { BranchNode } from './branchNode';
import { BranchOrTagFolderNode } from './branchOrTagFolderNode';
import { MessageNode } from './common';

export class BranchesNode extends CacheableChildrenViewNode<'branches', ViewsWithBranchesNode> {
	constructor(
		uri: GitUri,
		view: ViewsWithBranchesNode,
		protected override readonly parent: ViewNode,
		public readonly repo: Repository,
	) {
		super('branches', uri, view, parent);

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
			const branches = await this.repo.git.getBranches({
				// only show local branches
				filter: b => !b.remote,
				sort: this.view.config.showCurrentBranchOnTop
					? {
							current: true,
							openedWorktreesByBranch: getOpenedWorktreesByBranch(this.context.worktreesByBranch),
					  }
					: { current: false },
			});
			if (branches.values.length === 0) return [new MessageNode(this.view, this, 'No branches could be found.')];

			// TODO@eamodio handle paging
			const branchNodes = branches.values.map(
				b =>
					new BranchNode(
						GitUri.fromRepoPath(this.uri.repoPath!, b.ref),
						this.view,
						this,
						this.repo,
						b,
						false,
						{
							showComparison:
								this.view.type === 'repositories'
									? this.view.config.branches.showBranchComparison
									: this.view.config.showBranchComparison,
						},
					),
			);
			if (this.view.config.branches.layout === 'list') return branchNodes;

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

			const root = new BranchOrTagFolderNode(this.view, this, 'branch', hierarchy, this.repo.path, '', undefined);
			this.children = root.getChildren();
		}

		return this.children;
	}

	async getTreeItem(): Promise<TreeItem> {
		const item = new TreeItem('Branches', TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.contextValue = ContextValues.Branches;
		if ((await this.repo.git.getRemotes()).length) {
			item.contextValue += '+remotes';
		}
		// TODO@axosoft-ramint Temporary workaround, remove when our git commands work on closed repos.
		if (this.repo.closed) {
			item.contextValue += '+closed';
		}
		item.iconPath = new ThemeIcon('git-branch');

		return item;
	}

	@debug()
	override refresh() {
		super.refresh(true);
	}
}
