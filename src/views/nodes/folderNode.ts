'use strict';
import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ViewFilesLayout, ViewsFilesConfig } from '../../configuration';
import { GitUri } from '../../git/gitService';
import { Arrays } from '../../system';
import { ViewWithFiles } from '../viewBase';
import { ResourceType, ViewNode } from './viewNode';

export interface FileNode extends ViewNode {
	folderName: string;
	label?: string;
	priority: number;
	relativePath?: string;
	root?: Arrays.HierarchicalItem<FileNode>;
}

export class FolderNode extends ViewNode<ViewWithFiles> {
	readonly priority: number = 1;

	constructor(
		view: ViewWithFiles,
		parent: ViewNode,
		public readonly repoPath: string,
		public readonly folderName: string,
		public readonly root: Arrays.HierarchicalItem<FileNode>,
		private readonly containsWorkingFiles?: boolean,
		public readonly relativePath?: string
	) {
		super(GitUri.fromRepoPath(repoPath), view, parent);
	}

	toClipboard(): string {
		return this.folderName;
	}

	getChildren(): (FolderNode | FileNode)[] {
		if (this.root.descendants === undefined || this.root.children === undefined) return [];

		let children: (FolderNode | FileNode)[];

		const nesting = FolderNode.getFileNesting(
			this.view.config.files,
			this.root.descendants,
			this.relativePath === undefined
		);
		if (nesting === ViewFilesLayout.List) {
			this.root.descendants.forEach(n => (n.relativePath = this.root.relativePath));
			children = this.root.descendants;
		} else {
			children = [];
			for (const folder of this.root.children.values()) {
				if (folder.value === undefined) {
					children.push(
						new FolderNode(
							this.view,
							this.folderName ? this : this.parent!,
							this.repoPath,
							folder.name,
							folder,
							this.containsWorkingFiles,
							folder.relativePath
						)
					);
					continue;
				}

				// Make sure to set the parent
				(folder.value as any).parent = this.folderName ? this : this.parent!;
				folder.value.relativePath = this.root.relativePath;
				children.push(folder.value);
			}
		}

		children.sort((a, b) => {
			return (
				(a instanceof FolderNode ? -1 : 1) - (b instanceof FolderNode ? -1 : 1) ||
				a.priority - b.priority ||
				a.label!.localeCompare(b.label!, undefined, { numeric: true, sensitivity: 'base' })
			);
		});

		return children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(this.label, TreeItemCollapsibleState.Expanded);
		item.contextValue = ResourceType.Folder;
		if (this.containsWorkingFiles) {
			item.contextValue += '+working';
		}
		item.iconPath = ThemeIcon.Folder;
		item.tooltip = this.label;
		return item;
	}

	get label(): string {
		return this.folderName;
	}

	static getFileNesting<T extends FileNode>(
		config: ViewsFilesConfig,
		children: T[],
		isRoot: boolean
	): ViewFilesLayout {
		const nesting = config.layout || ViewFilesLayout.Auto;
		if (nesting === ViewFilesLayout.Auto) {
			if (isRoot || config.compact) {
				const nestingThreshold = config.threshold || 5;
				if (children.length <= nestingThreshold) return ViewFilesLayout.List;
			}
			return ViewFilesLayout.Tree;
		}
		return nesting;
	}
}
