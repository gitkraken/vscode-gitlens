import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../../git/gitUri';
import type { GitBranch } from '../../git/models/branch';
import type { Repository } from '../../git/models/repository';
import { getBranchMergeBaseAndCommonCommit } from '../../git/utils/-webview/branch.utils';
import { getOpenedWorktreesByBranch } from '../../git/utils/-webview/worktree.utils';
import { getLocalBranchUpstreamNames } from '../../git/utils/branch.utils';
import { makeHierarchical } from '../../system/array';
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
			const defaultRemote = showRemoteBranches
				? (await this.repo.git.remotes.getDefaultRemote())?.name
				: undefined;

			const options: Parameters<(typeof this.repo.git.branches)['getBranches']>['0'] = {
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

			const branches = new PageableResult<GitBranch>(p =>
				this.repo.git.branches.getBranches({ ...options, paging: p }),
			);

			let localUpstreamNames: Set<string> | undefined;
			// Filter out remote branches that have a local branch
			if (defaultRemote != null) {
				localUpstreamNames = await getLocalBranchUpstreamNames(branches);
			}

			// Create a map of branch names to their remote status for efficient lookup
			const branchRemoteMap = new Map<string, boolean>();
			for await (const branch of branches.values()) {
				branchRemoteMap.set(branch.name, branch.remote);
			}

			const branchNodes: BranchNode[] = [];

			for await (const branch of branches.values()) {
				if (branch.remote && localUpstreamNames?.has(branch.name)) continue;

				const mergeBaseResult =
					branch && (await getBranchMergeBaseAndCommonCommit(this.view.container, branch));
				const isRecomposable = Boolean(mergeBaseResult && mergeBaseResult.commit !== branch?.sha);
				const mergeBase = isRecomposable ? mergeBaseResult : undefined;

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
						mergeBase && {
							...mergeBase,
							remote: branchRemoteMap.get(mergeBase.branch) ?? false,
						},
					),
				);
			}

			if (branchNodes.length === 0) return [new MessageNode(this.view, this, 'No branches could be found.')];
			if (this.view.config.branches.layout === 'list') {
				this.children = branchNodes;
				return branchNodes;
			}

			const hierarchy = makeHierarchical(
				branchNodes,
				n => n.treeHierarchy,
				(...paths) => paths.join('/'),
				this.view.config.branches.compact,
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
		if ((await this.repo.git.remotes.getRemotes()).length) {
			item.contextValue += '+remotes';
		}
		// TODO@axosoft-ramint Temporary workaround, remove when our git commands work on closed repos.
		if (this.repo.closed) {
			item.contextValue += '+closed';
		}
		item.iconPath = new ThemeIcon('git-branch');

		return item;
	}
}
