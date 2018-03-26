'use strict';
import { Arrays, Objects } from '../system';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { BranchNode } from './branchNode';
// import { Container } from '../container';
import { Explorer, ExplorerNode, ResourceType } from './explorerNode';
import { GitUri } from '../gitService';

export class BranchFolderNode extends ExplorerNode {

    constructor(
        public readonly repoPath: string,
        public readonly branchFolderName: string,
        public readonly relativePath: string | undefined,
        public readonly root: Arrays.IHierarchicalItem<BranchNode>,
        private readonly explorer: Explorer
    ) {
        super(GitUri.fromRepoPath(repoPath));
    }

    async getChildren(): Promise<ExplorerNode[]> {
        if (this.root.descendants === undefined || this.root.children === undefined) return [];

        const children: (BranchFolderNode | BranchNode)[] = [];

        for (const folder of Objects.values(this.root.children)) {
            if (folder.value === undefined) {
                children.push(new BranchFolderNode(this.repoPath, folder.name, folder.relativePath, folder, this.explorer));
                continue;
            }
            children.push(folder.value);
        }

        return children;
    }

    async getTreeItem(): Promise<TreeItem> {
        const item = new TreeItem(this.label, TreeItemCollapsibleState.Collapsed);
        item.contextValue = ResourceType.Folder;
        item.resourceUri = this.explorer.folderResourceUri;
        item.tooltip = this.label;
        return item;
    }

    get label(): string {
        return this.branchFolderName;
    }
}
