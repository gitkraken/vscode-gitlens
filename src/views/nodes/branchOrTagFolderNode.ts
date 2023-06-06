import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../../git/gitUri';
import type { HierarchicalItem } from '../../system/array';
import type { View } from '../viewBase';
import { BranchNode } from './branchNode';
import { RepositoryNode } from './repositoryNode';
import type { TagNode } from './tagNode';
import { ContextValues, ViewNode } from './viewNode';

export class BranchOrTagFolderNode extends ViewNode {
	static getId(
		repoPath: string,
		key: string | undefined,
		type: string,
		relativePath: string | undefined,
		workspaceId?: string,
	): string {
		return `${RepositoryNode.getId(repoPath, workspaceId)}:${
			key === undefined ? type : `${key}:${type}`
		}-folder(${relativePath})`;
	}

	constructor(
		view: View,
		protected override readonly parent: ViewNode,
		public readonly type: 'branch' | 'remote-branch' | 'tag',
		public readonly repoPath: string,
		public readonly folderName: string,
		public readonly relativePath: string | undefined,
		public readonly root: HierarchicalItem<BranchNode | TagNode>,
		private readonly _key?: string,
		private readonly _expanded: boolean = false,
		private readonly options?: { workspaceId?: string },
	) {
		super(GitUri.fromRepoPath(repoPath), view, parent);
	}

	override toClipboard(): string {
		return this.folderName;
	}

	override get id(): string {
		return BranchOrTagFolderNode.getId(
			this.repoPath,
			this._key,
			this.type,
			this.relativePath,
			this.options?.workspaceId,
		);
	}

	getChildren(): ViewNode[] {
		if (this.root.descendants === undefined || this.root.children === undefined) return [];

		const children: (BranchOrTagFolderNode | BranchNode | TagNode)[] = [];

		for (const folder of this.root.children.values()) {
			if (folder.value === undefined) {
				// If the folder contains the current branch, expand it by default
				const expanded = folder.descendants?.some(n => n instanceof BranchNode && n.current);
				children.push(
					new BranchOrTagFolderNode(
						this.view,
						this.folderName ? this : this.parent,
						this.type,
						this.repoPath,
						folder.name,
						folder.relativePath,
						folder,
						this._key,
						expanded,
						this.options,
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
			this._expanded ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed,
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
