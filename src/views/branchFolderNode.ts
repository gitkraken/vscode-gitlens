'use strict';
import { Arrays, Objects } from '../system';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Container } from '../container';
import { Explorer, ExplorerNode, ResourceType } from './explorerNode';
import { BranchNode } from './branchNode';
import { ExplorerBranchesLayout } from '../configuration';
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

        if (this.explorer.config.branches.layout === ExplorerBranchesLayout.Tree) {
            // sort strategy: normal branches - folder branches (alphabetical order)
            children.sort((a, b) => {
                return ((a instanceof BranchNode) ? -1 : 1) - ((b instanceof BranchNode) ? -1 : 1) ||
                    a.label!.localeCompare(b.label!);
            });
        }

        return children;
  }

  async getTreeItem(): Promise<TreeItem> {
        // TODO: Change this to expanded once https://github.com/Microsoft/vscode/issues/30918 is fixed
        const item = new TreeItem(this.label, TreeItemCollapsibleState.Collapsed);
        item.contextValue = ResourceType.Folder;
        item.iconPath = {
            dark: Container.context.asAbsolutePath('images/dark/folder.svg'),
            light: Container.context.asAbsolutePath('images/light/folder.svg')
        };
        return item;
  }

    get label(): string {
        return this.branchFolderName;
    }
}
