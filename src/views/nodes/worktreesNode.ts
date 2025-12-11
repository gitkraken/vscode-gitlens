import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GlyphChars } from '../../constants';
import type { GitUri } from '../../git/gitUri';
import type { Repository } from '../../git/models/repository';
import { sortWorktrees } from '../../git/utils/-webview/sorting';
import { makeHierarchical } from '../../system/array';
import type { ViewsWithWorktreesNode } from '../viewBase';
import { CacheableChildrenViewNode } from './abstract/cacheableChildrenViewNode';
import type { ViewNode } from './abstract/viewNode';
import { ContextValues, getViewNodeId } from './abstract/viewNode';
import { BranchOrTagFolderNode } from './branchOrTagFolderNode';
import { MessageNode } from './common';
import { WorktreeNode } from './worktreeNode';

export class WorktreesNode extends CacheableChildrenViewNode<'worktrees', ViewsWithWorktreesNode> {
	constructor(
		uri: GitUri,
		view: ViewsWithWorktreesNode,
		protected override readonly parent: ViewNode,
		public readonly repo: Repository,
	) {
		super('worktrees', uri, view, parent);

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
			const access = await this.repo.access('worktrees');
			if (!access.allowed) return [];

			const worktrees = await this.repo.git.worktrees?.getWorktrees();
			if (!worktrees?.length) return [new MessageNode(this.view, this, 'No worktrees could be found.')];

			const children = sortWorktrees(worktrees).map(w => new WorktreeNode(this.uri, this.view, this, w));

			if (this.view.config.branches.layout === 'list' || this.view.config.worktrees.viewAs !== 'name') {
				this.children = children;
				return children;
			}

			const hierarchy = makeHierarchical(
				children,
				n => n.treeHierarchy,
				(...paths) => paths.join('/'),
				this.view.config.branches.compact,
				w => {
					w.compacted = true;
					return true;
				},
			);

			const root = new BranchOrTagFolderNode(
				this.view,
				this,
				'worktree',
				hierarchy,
				this.repo.path,
				'',
				undefined,
			);
			this.children = root.getChildren();
		}

		return this.children;
	}

	async getTreeItem(): Promise<TreeItem> {
		const access = await this.repo.access('worktrees');

		const item = new TreeItem(
			'Worktrees',
			access.allowed ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None,
		);
		item.id = this.id;
		item.contextValue = ContextValues.Worktrees;
		item.description = access.allowed
			? undefined
			: ` ${GlyphChars.Warning}  Unlock this feature for privately hosted repos with GitLens Pro`;
		// TODO@eamodio `folder` icon won't work here for some reason
		item.iconPath = new ThemeIcon('folder-opened');
		return item;
	}
}
