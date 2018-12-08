'use strict';
import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../../git/gitService';
import { Arrays, Objects } from '../../system';
import { View } from '../viewBase';
import { BranchNode } from './branchNode';
import { TagNode } from './tagNode';
import { ResourceType, ViewNode } from './viewNode';

const set = new Set();

export class BranchOrTagFolderNode extends ViewNode {
    constructor(
        view: View,
        parent: ViewNode,
        public readonly type: 'branch' | 'remote-branch' | 'tag',
        public readonly repoPath: string,
        public readonly folderName: string,
        public readonly relativePath: string | undefined,
        public readonly root: Arrays.IHierarchicalItem<BranchNode | TagNode>,
        private readonly _expanded: boolean = false
    ) {
        super(GitUri.fromRepoPath(repoPath), view, parent);
    }

    get id(): string {
        return `gitlens:repository(${this.repoPath}):${this.type}-folder(${this.relativePath})`;
    }

    async getChildren(): Promise<ViewNode[]> {
        if (this.root.descendants === undefined || this.root.children === undefined) return [];

        const children: (BranchOrTagFolderNode | BranchNode | TagNode)[] = [];

        for (const folder of Objects.values(this.root.children)) {
            if (folder.value === undefined) {
                // If the folder contains the current branch, expand it by default
                const expanded =
                    folder.descendants !== undefined &&
                    folder.descendants.some(n => n instanceof BranchNode && n.current);
                children.push(
                    new BranchOrTagFolderNode(
                        this.view,
                        this,
                        this.type,
                        this.repoPath,
                        folder.name,
                        folder.relativePath,
                        folder,
                        expanded
                    )
                );
                continue;
            }

            children.push(folder.value);
        }

        return children;
    }

    async getTreeItem(): Promise<TreeItem> {
        const item = new TreeItem(
            this.label,
            this._expanded ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed
        );
        item.id = this.id;
        item.contextValue = ResourceType.Folder;
        item.iconPath = ThemeIcon.Folder;
        item.tooltip = this.label;
        return item;
    }

    get label(): string {
        return this.folderName;
    }
}
