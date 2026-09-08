import { l10n, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { makeHierarchical } from '@gitlens/utils/array.js';
import { GlyphChars } from '../../constants.js';
import type { GitUri } from '../../git/gitUri.js';
import type { GlRepository } from '../../git/models/repository.js';
import { sortWorktrees } from '../../git/utils/-webview/sorting.js';
import type { ViewsWithWorktreesNode } from '../viewBase.js';
import { CacheableChildrenViewNode } from './abstract/cacheableChildrenViewNode.js';
import type { ViewNode } from './abstract/viewNode.js';
import { ContextValues, getViewNodeId } from './abstract/viewNode.js';
import { BranchOrTagFolderNode } from './branchOrTagFolderNode.js';
import { MessageNode } from './common.js';
import { WorktreeNode } from './worktreeNode.js';

export class WorktreesNode extends CacheableChildrenViewNode<'worktrees', ViewsWithWorktreesNode> {
	constructor(
		uri: GitUri,
		view: ViewsWithWorktreesNode,
		protected override readonly parent: ViewNode,
		public readonly repo: GlRepository,
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
			const access = await this.repo.git.access('worktrees');
			if (!access.allowed) return [];

			const worktrees = await this.repo.git.worktrees?.getWorktrees();
			if (!worktrees?.length) {
				return [new MessageNode(this.view, this, l10n.t('No worktrees could be found.'))];
			}

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
		const access = await this.repo.git.access('worktrees');

		const item = new TreeItem(
			l10n.t('Worktrees'),
			access.allowed ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None,
		);
		item.id = this.id;
		item.contextValue = ContextValues.Worktrees;
		item.description = access.allowed
			? undefined
			: l10n.t(' {0}  Unlock this feature for privately hosted repos with GitLens Pro', GlyphChars.Warning);
		// TODO@eamodio `folder` icon won't work here for some reason
		item.iconPath = new ThemeIcon('folder-opened');
		return item;
	}
}
