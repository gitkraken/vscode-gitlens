'use strict';
import { Iterables } from '../system';
import { ExtensionContext, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { CommitNode } from './commitNode';
import { ExplorerNode, ResourceType, TextExplorerNode } from './explorerNode';
import { GitService, GitUri } from '../gitService';

export class FileHistoryNode extends ExplorerNode {

    static readonly rootType: ResourceType = 'file-history';
    readonly resourceType: ResourceType = 'file-history';

    constructor(uri: GitUri, protected readonly context: ExtensionContext, protected readonly git: GitService) {
        super(uri);
     }

    async getChildren(): Promise<ExplorerNode[]> {
        const log = await this.git.getLogForFile(this.uri.repoPath, this.uri.fsPath, this.uri.sha);
        if (log === undefined) return [new TextExplorerNode('No file history')];

        return [...Iterables.map(log.commits.values(), c => new CommitNode(c, this.git.config.fileHistoryExplorer.commitFormat, this.context, this.git))];
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(`History of ${this.uri.getFormattedPath()}`, TreeItemCollapsibleState.Expanded);
        item.contextValue = this.resourceType;
        return item;
    }
}