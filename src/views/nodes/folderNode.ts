'use strict';
import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ViewFilesLayout, ViewsFilesConfig } from '../../configuration';
import { GitUri } from '../../git/gitService';
import { Arrays, Objects } from '../../system';
import { ViewWithFiles } from '../viewBase';
import { ResourceType, ViewNode } from './viewNode';

export interface FileNode extends ViewNode {
    folderName: string;
    label?: string;
    priority: number;
    relativePath?: string;
    root?: Arrays.IHierarchicalItem<FileNode>;
}

export class FolderNode extends ViewNode<ViewWithFiles> {
    readonly priority: number = 1;

    constructor(
        view: ViewWithFiles,
        parent: ViewNode,
        public readonly repoPath: string,
        public readonly folderName: string,
        public readonly root: Arrays.IHierarchicalItem<FileNode>,
        public readonly relativePath?: string
    ) {
        super(GitUri.fromRepoPath(repoPath), view, parent);
    }

    async getChildren(): Promise<(FolderNode | FileNode)[]> {
        if (this.root.descendants === undefined || this.root.children === undefined) return [];

        let children: (FolderNode | FileNode)[];

        const nesting = FolderNode.getFileNesting(
            this.view.config.files,
            this.root.descendants,
            this.relativePath === undefined
        );
        if (nesting !== ViewFilesLayout.List) {
            children = [];
            for (const folder of Objects.values(this.root.children)) {
                if (folder.value === undefined) {
                    children.push(
                        new FolderNode(this.view, this, this.repoPath, folder.name, folder, folder.relativePath)
                    );
                    continue;
                }

                folder.value.relativePath = this.root.relativePath;
                children.push(folder.value);
            }
        }
        else {
            this.root.descendants.forEach(n => (n.relativePath = this.root.relativePath));
            children = this.root.descendants;
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

    async getTreeItem(): Promise<TreeItem> {
        // TODO: Change this to expanded once https://github.com/Microsoft/vscode/issues/30918 is fixed
        const item = new TreeItem(this.label, TreeItemCollapsibleState.Collapsed);
        item.contextValue = ResourceType.Folder;
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
