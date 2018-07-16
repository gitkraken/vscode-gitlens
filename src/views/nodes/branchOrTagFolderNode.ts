'use strict';
import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../../gitService';
import { Arrays, Objects } from '../../system';
import { BranchNode } from './branchNode';
// import { Container } from '../../container';
import { Explorer, ExplorerNode, ResourceType } from './explorerNode';
import { TagNode } from './tagNode';

export class BranchOrTagFolderNode extends ExplorerNode {
    constructor(
        public readonly repoPath: string,
        public readonly folderName: string,
        public readonly relativePath: string | undefined,
        public readonly root: Arrays.IHierarchicalItem<BranchNode | TagNode>,
        private readonly explorer: Explorer
    ) {
        super(GitUri.fromRepoPath(repoPath));
    }

    async getChildren(): Promise<ExplorerNode[]> {
        if (this.root.descendants === undefined || this.root.children === undefined) return [];

        const children: (BranchOrTagFolderNode | BranchNode | TagNode)[] = [];

        for (const folder of Objects.values(this.root.children)) {
            if (folder.value === undefined) {
                children.push(
                    new BranchOrTagFolderNode(this.repoPath, folder.name, folder.relativePath, folder, this.explorer)
                );
                continue;
            }
            children.push(folder.value);
        }

        return children;
    }

    async getTreeItem(): Promise<TreeItem> {
        const item = new TreeItem(this.label, TreeItemCollapsibleState.Collapsed);
        item.contextValue = ResourceType.Folder;
        item.iconPath = ThemeIcon.Folder;
        item.tooltip = this.label;
        return item;
    }

    get label(): string {
        return this.folderName;
    }
}
