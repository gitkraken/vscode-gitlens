'use strict';
import { Arrays, Objects } from '../system';
import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ExplorerFilesLayout, IExplorersFilesConfig } from '../configuration';
import { Explorer, ExplorerNode, ResourceType } from './explorerNode';
import { GitUri } from '../gitService';

export interface IFileExplorerNode extends ExplorerNode {
    folderName: string;
    label?: string;
    priority: boolean;
    relativePath?: string;
    root?: Arrays.IHierarchicalItem<IFileExplorerNode>;
}

export class FolderNode extends ExplorerNode {

    readonly priority: boolean = true;

    constructor(
        public readonly repoPath: string,
        public readonly folderName: string,
        public readonly relativePath: string | undefined,
        public readonly root: Arrays.IHierarchicalItem<IFileExplorerNode>,
        private readonly explorer: Explorer
    ) {
        super(GitUri.fromRepoPath(repoPath));
    }

    async getChildren(): Promise<(FolderNode | IFileExplorerNode)[]> {
        if (this.root.descendants === undefined || this.root.children === undefined) return [];

        let children: (FolderNode | IFileExplorerNode)[];

        const nesting = FolderNode.getFileNesting(this.explorer.config.files, this.root.descendants, this.relativePath === undefined);
        if (nesting !== ExplorerFilesLayout.List) {
            children = [];
            for (const folder of Objects.values(this.root.children)) {
                if (folder.value === undefined) {
                    children.push(new FolderNode(this.repoPath, folder.name, folder.relativePath, folder, this.explorer));
                    continue;
                }

                folder.value.relativePath = this.root.relativePath;
                children.push(folder.value);
            }
        }
        else {
            this.root.descendants.forEach(n => n.relativePath = this.root.relativePath);
            children = this.root.descendants;
        }

        children.sort((a, b) => {
            return ((a instanceof FolderNode) ? -1 : 1) - ((b instanceof FolderNode) ? -1 : 1) ||
                (a.priority ? -1 : 1) - (b.priority ? -1 : 1) ||
                a.label!.localeCompare(b.label!);
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

    static getFileNesting<T extends IFileExplorerNode>(config: IExplorersFilesConfig, children: T[], isRoot: boolean): ExplorerFilesLayout {
        const nesting = config.layout || ExplorerFilesLayout.Auto;
        if (nesting === ExplorerFilesLayout.Auto) {
            if (isRoot || config.compact) {
                const nestingThreshold = config.threshold || 5;
                if (children.length <= nestingThreshold) return ExplorerFilesLayout.List;
            }
            return ExplorerFilesLayout.Tree;
        }
        return nesting;
    }
}