'use strict';
import { Command, Event, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../gitService';

export declare type ResourceType =
    'gitlens:branches' |
    'gitlens:branch-history' |
    'gitlens:commit' |
    'gitlens:commit-file' |
    'gitlens:file-history' |
    'gitlens:history' |
    'gitlens:message' |
    'gitlens:remote' |
    'gitlens:remotes' |
    'gitlens:repository' |
    'gitlens:stash' |
    'gitlens:stash-file' |
    'gitlens:stashes' |
    'gitlens:status' |
    'gitlens:status-upstream';

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

export class MessageNode extends ExplorerNode {

    readonly resourceType: ResourceType = 'gitlens:message';

    constructor(private message: string) {
        super(new GitUri());
    }

    getChildren(): ExplorerNode[] | Promise<ExplorerNode[]> {
        return [];
    }

    getTreeItem(): TreeItem | Promise<TreeItem> {
        const item = new TreeItem(this.message, TreeItemCollapsibleState.None);
        item.contextValue = this.resourceType;
        return item;
    }
}