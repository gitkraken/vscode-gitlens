'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ResultsExplorer } from '../resultsExplorer';
import { MessageNode } from './common';
import { ExplorerNode, ResourceType, unknownGitUri } from './explorerNode';

export class ResultsNode extends ExplorerNode {
    private _children: (ExplorerNode | MessageNode)[] = [];

    constructor(
        public readonly explorer: ResultsExplorer
    ) {
        super(unknownGitUri);
    }

    async getChildren(): Promise<ExplorerNode[]> {
        if (this._children.length === 0) return [new MessageNode('No results')];

        return this._children;
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(`Results`, TreeItemCollapsibleState.Expanded);
        item.contextValue = ResourceType.Results;
        return item;
    }

    addOrReplace(results: ExplorerNode, replace: boolean) {
        if (this._children.includes(results)) return;

        if (this._children.length !== 0 && replace) {
            this._children.length = 0;
            this._children.push(results);
        }
        else {
            this._children.splice(0, 0, results);
        }

        this.explorer.triggerNodeUpdate();
    }

    clear() {
        if (this._children.length === 0) return;

        this._children.length = 0;
        this.explorer.triggerNodeUpdate();
    }

    dismiss(node: ExplorerNode) {
        if (this._children.length === 0) return;

        const index = this._children.findIndex(n => n === node);
        if (index === -1) return;

        this._children.splice(index, 1);
        this.explorer.triggerNodeUpdate();
    }

    async refresh() {
        if (this._children.length === 0) return;

        this._children.forEach(c => c.refresh());
    }
}
