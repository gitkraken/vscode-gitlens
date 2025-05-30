import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GlyphChars } from '../../constants';
import { PlusFeatures } from '../../features';
import type { GitUri } from '../../git/gitUri';
import type { Repository } from '../../git/models/repository';
import { gate } from '../../system/decorators/gate';
import { debug } from '../../system/decorators/log';
import type { RepositoriesView } from '../repositoriesView';
import type { WorktreesView } from '../worktreesView';
import { MessageNode } from './common';
import { RepositoryNode } from './repositoryNode';
import { ContextValues, ViewNode } from './viewNode';
import { WorktreeNode } from './worktreeNode';

export class WorktreesNode extends ViewNode<WorktreesView | RepositoriesView> {
	static key = ':worktrees';
	static getId(repoPath: string): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}`;
	}

	private _children: WorktreeNode[] | undefined;

	constructor(
		uri: GitUri,
		view: WorktreesView | RepositoriesView,
		parent: ViewNode,
		public readonly repo: Repository,
	) {
		super(uri, view, parent);
	}

	override get id(): string {
		return WorktreesNode.getId(this.repo.path);
	}

	get repoPath(): string {
		return this.repo.path;
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this._children == null) {
			const access = await this.repo.access(PlusFeatures.Worktrees);
			if (!access.allowed) return [];

			const worktrees = await this.repo.getWorktrees();
			if (worktrees.length === 0) return [new MessageNode(this.view, this, 'No worktrees could be found.')];

			this._children = worktrees.map(c => new WorktreeNode(this.uri, this.view, this, c));
		}

		return this._children;
	}

	async getTreeItem(): Promise<TreeItem> {
		const access = await this.repo.access(PlusFeatures.Worktrees);

		const item = new TreeItem(
			'Worktrees',
			access.allowed ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None,
		);
		item.id = this.id;
		item.contextValue = ContextValues.Worktrees;
		item.description = access.allowed
			? undefined
			: ` ${GlyphChars.Warning}  Requires GitLens Pro to access Worktrees on private repos`;
		// TODO@eamodio `folder` icon won't work here for some reason
		item.iconPath = new ThemeIcon('folder-opened');
		return item;
	}

	@gate()
	@debug()
	override refresh() {
		this._children = undefined;
	}
}
