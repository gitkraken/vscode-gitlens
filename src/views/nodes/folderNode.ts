import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { ViewFilesLayout, ViewsFilesConfig } from '../../config';
import { GitUri } from '../../git/gitUri';
import type { HierarchicalItem } from '../../system/array';
import { sortCompare } from '../../system/string';
import type { StashesView } from '../stashesView';
import type { ViewsWithCommits } from '../viewBase';
import type { ViewFileNode } from './abstract/viewFileNode';
import { ContextValues, getViewNodeId, ViewNode } from './abstract/viewNode';

export interface FileNode extends ViewFileNode {
	folderName: string;
	priority: number;

	label?: string;
	relativePath?: string;

	// root?: HierarchicalItem<FileNode>;
}

export class FolderNode extends ViewNode<'folder', ViewsWithCommits | StashesView> {
	readonly priority: number = 1;

	constructor(
		view: ViewsWithCommits | StashesView,
		protected override parent: ViewNode,
		public readonly root: HierarchicalItem<FileNode>,
		public readonly repoPath: string,
		public readonly folderName: string,
		public readonly relativePath: string | undefined,
		private readonly containsWorkingFiles?: boolean,
	) {
		super('folder', GitUri.fromRepoPath(repoPath), view, parent);

		this._uniqueId = getViewNodeId(`${this.type}+${relativePath ?? folderName}`, this.context);
	}

	override get id(): string {
		return this._uniqueId;
	}

	override toClipboard(): string {
		return this.folderName;
	}

	getChildren(): (FolderNode | FileNode)[] {
		if (this.root.descendants === undefined || this.root.children === undefined) return [];

		let children: (FolderNode | FileNode)[];

		const nesting = FolderNode.getFileNesting(
			this.view.config.files,
			this.root.descendants,
			this.relativePath === undefined,
		);
		if (nesting === 'list') {
			this.root.descendants.forEach(n => (n.relativePath = this.root.relativePath));
			children = this.root.descendants;
		} else {
			children = [];
			for (const folder of this.root.children.values()) {
				if (folder.value === undefined) {
					children.push(
						new FolderNode(
							this.view,
							this.folderName ? this : this.parent,
							folder,
							this.repoPath,
							folder.name,
							folder.relativePath,
							this.containsWorkingFiles,
						),
					);
					continue;
				}

				// Make sure to set the parent
				folder.value.parent = this.folderName ? this : this.parent;
				folder.value.relativePath = this.root.relativePath;
				children.push(folder.value);
			}
		}

		children.sort((a, b) => {
			return (
				(a instanceof FolderNode ? -1 : 1) - (b instanceof FolderNode ? -1 : 1) ||
				a.priority - b.priority ||
				sortCompare(a.label!, b.label!)
			);
		});

		return children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(this.label, TreeItemCollapsibleState.Expanded);
		item.id = this.id;
		item.contextValue = ContextValues.Folder;
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
		isRoot: boolean,
	): ViewFilesLayout {
		const nesting = config.layout || 'auto';
		if (nesting === 'auto') {
			if (isRoot || config.compact) {
				const nestingThreshold = config.threshold || 5;
				if (children.length <= nestingThreshold) return 'list';
			}
			return 'tree';
		}
		return nesting;
	}
}
