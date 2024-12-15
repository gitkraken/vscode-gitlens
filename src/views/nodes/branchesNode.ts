import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../../git/gitUri';
import type { GitBranch } from '../../git/models/branch';
import { getLocalBranchUpstreamNames } from '../../git/models/branch.utils';
import type { Repository } from '../../git/models/repository';
import { getOpenedWorktreesByBranch } from '../../git/models/worktree.utils';
import { makeHierarchical } from '../../system/array';
import { debug } from '../../system/decorators/log';
import { PageableResult } from '../../system/paging';
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
			const showRemoteBranches = this.view.type === 'branches' && this.view.config.showRemoteBranches;
			const defaultRemote = showRemoteBranches ? (await this.repo.git.getDefaultRemote())?.name : undefined;

			const options: Parameters<typeof this.repo.git.getBranches>['0'] = {
				// only show local branches or remote branches for the default remote
				filter: b =>
					!b.remote || (showRemoteBranches && defaultRemote != null && b.getRemoteName() === defaultRemote),
				sort: this.view.config.showCurrentBranchOnTop
					? {
							current: true,
							groupByType: defaultRemote == null,
							openedWorktreesByBranch: getOpenedWorktreesByBranch(this.context.worktreesByBranch),
					  }
					: { current: false, groupByType: defaultRemote == null },
			};

			const branches = new PageableResult<GitBranch>(p => this.repo.git.getBranches({ ...options, paging: p }));

			let localUpstreamNames: Set<string> | undefined;
			// Filter out remote branches that have a local branch
			if (defaultRemote != null) {
				localUpstreamNames = await getLocalBranchUpstreamNames(branches);
			}

			const branchNodes: BranchNode[] = [];

			for await (const branch of branches.values()) {
				if (branch.remote && localUpstreamNames?.has(branch.name)) continue;

				branchNodes.push(
					new BranchNode(
						GitUri.fromRepoPath(this.uri.repoPath!, branch.ref),
						this.view,
						this,
						this.repo,
						branch,
						false,
						{
							showComparison:
								this.view.type === 'repositories'
									? this.view.config.branches.showBranchComparison
									: this.view.config.showBranchComparison,
							showStashes: this.view.config.showStashes,
						},
					),
				);
			}

			if (branchNodes.length === 0) return [new MessageNode(this.view, this, 'No branches could be found.')];
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
