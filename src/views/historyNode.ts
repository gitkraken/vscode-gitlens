'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ExplorerNode, ResourceType } from './explorerNode';
import { FileHistoryNode } from './fileHistoryNode';
import { GitUri, Repository } from '../gitService';
import { GitExplorer } from './gitExplorer';

export class HistoryNode extends ExplorerNode {

    constructor(
        uri: GitUri,
        private readonly repo: Repository,
        private readonly explorer: GitExplorer
    ) {
        super(uri);
    }

    async getChildren(): Promise<ExplorerNode[]> {
        this.resetChildren();

        this.children = [
            new FileHistoryNode(this.uri, this.repo, this.explorer)
        ];
        return this.children;
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(`${this.uri.getFormattedPath()}`, TreeItemCollapsibleState.Expanded);
        item.contextValue = ResourceType.History;

        item.iconPath = {
            dark: this.explorer.context.asAbsolutePath('images/dark/icon-history.svg'),
            light: this.explorer.context.asAbsolutePath('images/light/icon-history.svg')
        };

        return item;
    }
}