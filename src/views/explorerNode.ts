'use strict';
import { Command, Event, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../gitService';

export declare type ResourceType = 'text' | 'status' | 'branches' | 'repository' | 'branch-history' | 'file-history' | 'stash-history' | 'commit' | 'stash-commit' | 'commit-file';

export abstract class ExplorerNode {

    abstract readonly resourceType: ResourceType;

    constructor(public readonly uri: GitUri) { }

    abstract getChildren(): ExplorerNode[] | Promise<ExplorerNode[]>;
    abstract getTreeItem(): TreeItem | Promise<TreeItem>;

    getCommand(): Command | undefined {
        return undefined;
    }

    onDidChangeTreeData?: Event<ExplorerNode>;

    refresh?(): void;
}

export class TextExplorerNode extends ExplorerNode {

    readonly resourceType: ResourceType = 'text';

    constructor(private text: string) {
        super(new GitUri());
    }

    getChildren(): ExplorerNode[] | Promise<ExplorerNode[]> {
        return [];
    }

    getTreeItem(): TreeItem | Promise<TreeItem> {
        const item = new TreeItem(this.text, TreeItemCollapsibleState.None);
        item.contextValue = this.resourceType;
        return item;
    }
}