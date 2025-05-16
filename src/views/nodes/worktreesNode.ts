import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GlyphChars } from '../../constants';
import type { GitUri } from '../../git/gitUri';
import type { Repository } from '../../git/models/repository';
import { sortWorktrees } from '../../git/utils/-webview/sorting';
import { filterMap, makeHierarchical } from '../../system/array';
import { map } from '../../system/iterable';
import { Logger } from '../../system/logger';
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

			const worktreeNodes = filterMap(
				await Promise.allSettled(
					map(sortWorktrees(worktrees), async w => {
						let status;
						let missing = false;
						try {
							status = await w.getStatus();
						} catch (ex) {
							Logger.error(ex, `Worktree status failed: ${w.uri.toString(true)}`);
							missing = true;
						}
						return new WorktreeNode(this.uri, this.view, this, w, { status: status, missing: missing });
					}),
				),
				r => (r.status === 'fulfilled' ? r.value : undefined),
			);

			if (this.view.config.branches.layout === 'list' || this.view.config.worktrees.viewAs !== 'name') {
				this.children = worktreeNodes;
				return worktreeNodes;
			}

			const hierarchy = makeHierarchical(
				worktreeNodes,
				n => n.treeHierarchy,
				(...paths) => paths.join('/'),
				this.view.config.files.compact,
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
			: ` ${GlyphChars.Warning}  Use on privately-hosted repos requires GitLens Pro`;
		// TODO@eamodio `folder` icon won't work here for some reason
		item.iconPath = new ThemeIcon('folder-opened');
		return item;
	}
}
