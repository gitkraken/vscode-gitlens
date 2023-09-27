import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../../git/gitUri';
import type { Repository } from '../../git/models/repository';
import { makeHierarchical } from '../../system/array';
import { gate } from '../../system/decorators/gate';
import { debug } from '../../system/decorators/log';
import { RepositoriesView } from '../repositoriesView';
import type { ViewsWithBranchesNode } from '../viewBase';
import { BranchNode } from './branchNode';
import { BranchOrTagFolderNode } from './branchOrTagFolderNode';
import { MessageNode } from './common';
import { ContextValues, getViewNodeId, ViewNode } from './viewNode';

export class BranchesNode extends ViewNode<ViewsWithBranchesNode> {
	constructor(
		uri: GitUri,
		view: ViewsWithBranchesNode,
		protected override readonly parent: ViewNode,
		public readonly repo: Repository,
	) {
		super(uri, view, parent);

		this.updateContext({ repository: repo });
		this._uniqueId = getViewNodeId('branches', this.context);
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
			const branches = await this.repo.getBranches({
				// only show local branches
				filter: b => !b.remote,
				sort: { current: false },
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
								this.view instanceof RepositoriesView
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
		// TODO@axosoft-ramint Temporary workaround, remove when our git commands work on closed repos.
		if (this.repo.closed) {
			item.contextValue += '+closed';
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
