import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../../git/gitUri';
import type { HierarchicalItem } from '../../system/array';
import type { View } from '../viewBase';
import { ContextValues, getViewNodeId, ViewNode } from './abstract/viewNode';
import type { BranchNode } from './branchNode';
import type { TagNode } from './tagNode';

export class BranchOrTagFolderNode extends ViewNode<'branch-tag-folder'> {
	constructor(
		view: View,
		protected override readonly parent: ViewNode,
		public readonly folderType: 'branch' | 'remote-branch' | 'tag',
		public readonly root: HierarchicalItem<BranchNode | TagNode>,
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
		if (this.root.descendants === undefined || this.root.children === undefined) return [];

		const children: (BranchOrTagFolderNode | BranchNode | TagNode)[] = [];

		for (const folder of this.root.children.values()) {
			if (folder.value === undefined) {
				// If the folder contains the current branch, expand it by default
				const expand = folder.descendants?.some(n => n.is('branch') && (n.current || n.worktree?.opened));
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
				continue;
			}

			// Make sure to set the parent
			folder.value.parent = this.folderName ? this : this.parent;
			children.push(folder.value);
		}

		return children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(
			this.label,
			this._expand ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed,
		);
		item.id = this.id;
		item.contextValue = ContextValues.Folder;
		item.iconPath = ThemeIcon.Folder;
		item.tooltip = this.label;
		return item;
	}

	get label(): string {
		return this.folderName;
	}
}
