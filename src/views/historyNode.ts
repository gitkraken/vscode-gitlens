'use strict';
import { ExtensionContext, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ExplorerNode, ResourceType } from './explorerNode';
import { FileHistoryNode } from './fileHistoryNode';
import { GitService, GitUri } from '../gitService';

export class HistoryNode extends ExplorerNode {

    readonly resourceType: ResourceType = 'gitlens:history';

    constructor(
        uri: GitUri,
        protected readonly context: ExtensionContext,
        protected readonly git: GitService
    ) {
        super(uri);
    }

    async getChildren(): Promise<ExplorerNode[]> {
        return [new FileHistoryNode(this.uri, this.context, this.git)];
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(`${this.uri.getFormattedPath()}`, TreeItemCollapsibleState.Expanded);
        item.contextValue = this.resourceType;

        item.iconPath = {
            dark: this.context.asAbsolutePath('images/dark/icon-history.svg'),
            light: this.context.asAbsolutePath('images/light/icon-history.svg')
        };

        return item;
    }
}