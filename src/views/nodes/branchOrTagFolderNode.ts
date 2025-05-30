import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../../git/gitUri';
import type { HierarchicalItem } from '../../system/array';
import { first } from '../../system/iterable';
import type {
	ViewsWithBranchesNode,
	ViewsWithRemotesNode,
	ViewsWithTagsNode,
	ViewsWithWorktreesNode,
} from '../viewBase';
import { ContextValues, getViewNodeId, ViewNode } from './abstract/viewNode';
import type { BranchNode } from './branchNode';
import type { TagNode } from './tagNode';
import type { WorktreeNode } from './worktreeNode';

export class BranchOrTagFolderNode extends ViewNode<
	'branch-tag-folder',
	ViewsWithBranchesNode | ViewsWithRemotesNode | ViewsWithTagsNode | ViewsWithWorktreesNode
> {
	constructor(
		view: ViewsWithBranchesNode | ViewsWithRemotesNode | ViewsWithTagsNode | ViewsWithWorktreesNode,
		protected override readonly parent: ViewNode,
		public readonly folderType: 'branch' | 'remote-branch' | 'tag' | 'worktree',
		public readonly root: HierarchicalItem<BranchNode | TagNode | WorktreeNode>,
		public readonly repoPath: string,
		public readonly folderName: string,
		public readonly relativePath: string | undefined,
		private readonly _expand: boolean = false,
	) {
		super('branch-tag-folder', GitUri.fromRepoPath(repoPath), view, parent);

		this._uniqueId = getViewNodeId(`${this.type}+${folderType}+${relativePath ?? folderName}`, this.context);
	}

	override get id(): string {
		return this._uniqueId;
	}

	override toClipboard(): string {
		return this.folderName;
	}

	getChildren(): ViewNode[] {
		if (!this.root.descendants?.length || !this.root.children?.size) return [];

		const children: (BranchOrTagFolderNode | BranchNode | TagNode | WorktreeNode)[] = [];
		const { compact } = this.view.config.branches;

		for (const folder of this.root.children.values()) {
			if (folder.value != null) {
				// Make sure to set the parent
				folder.value.parent = this.folderName ? this : this.parent;
				children.push(folder.value);
			}

			if (!folder.children?.size) continue;
			if (folder.children.size === 1 && compact) {
				const child = first(folder.children.values());
				if (child?.value != null) {
					// Make sure to set the parent
					child.value.parent = this.folderName ? this : this.parent;
					if ('compacted' in child.value && typeof child.value.compacted === 'boolean') {
						child.value.compacted = true;
					}
					children.push(child.value);
				}
			} else {
				// If the folder contains the current branch or an active worktree, expand it by default
				const expand = folder.descendants?.some(
					n =>
						(n.is('branch') && (n.current || n.worktree?.opened)) ||
						(n.is('worktree') && n.worktree?.opened),
				);
				children.push(
					new BranchOrTagFolderNode(
						this.view,
						this.folderName ? this : this.parent,
						this.folderType,
						folder,
						this.repoPath,
						folder.name,
						folder.relativePath,
						expand,
					),
				);
			}
		}

		return children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(
			this.label,
			this._expand ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed,
		);
		item.id = this.id;
		item.contextValue = ContextValues.BranchOrTagFolder;
		item.iconPath = ThemeIcon.Folder;
		item.tooltip = this.label;
		return item;
	}

	get label(): string {
		return this.folderName;
	}
}
