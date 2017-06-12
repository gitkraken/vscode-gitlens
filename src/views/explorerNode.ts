'use strict';
import { ExtensionContext, TreeItem } from 'vscode';
import { GitService, GitUri } from '../gitService';

export declare type ResourceType = 'status' | 'branches' | 'repository' | 'branch-history' | 'file-history' | 'stash-history' | 'commit' | 'stash-commit' | 'commit-file';

export abstract class ExplorerNode {

    abstract readonly resourceType: ResourceType;

    constructor(public uri: GitUri, protected context: ExtensionContext, protected git: GitService) { }

    abstract getChildren(): ExplorerNode[] | Promise<ExplorerNode[]>;
    abstract getTreeItem(): TreeItem | Promise<TreeItem>;
}