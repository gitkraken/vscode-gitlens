'use strict';
import { Command, Event, ExtensionContext, TreeItem } from 'vscode';
import { GitService, GitUri } from '../gitService';

export declare type ResourceType = 'status' | 'branches' | 'repository' | 'branch-history' | 'file-history' | 'stash-history' | 'commit' | 'stash-commit' | 'commit-file';

export abstract class ExplorerNode {

    abstract readonly resourceType: ResourceType;

    constructor(public readonly uri: GitUri, protected readonly context: ExtensionContext, protected readonly git: GitService) { }

    abstract getChildren(): ExplorerNode[] | Promise<ExplorerNode[]>;
    abstract getTreeItem(): TreeItem | Promise<TreeItem>;

    getCommand(): Command | undefined {
        return undefined;
    }

    onDidChangeTreeData?: Event<ExplorerNode>;

    refresh?(): void;
}