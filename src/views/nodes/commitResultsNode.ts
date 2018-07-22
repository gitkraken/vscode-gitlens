'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitLogCommit } from '../../gitService';
import { ResultsExplorer } from '../resultsExplorer';
import { CommitNode } from './commitNode';
import { ExplorerNode, ResourceType } from './explorerNode';

export class CommitResultsNode extends ExplorerNode {
    constructor(
        public readonly commit: GitLogCommit,
        private readonly explorer: ResultsExplorer
    ) {
        super(commit.toGitUri());
    }

    getChildren(): ExplorerNode[] {
        return [new CommitNode(this.commit, this.explorer)];
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(
            `1 result for commits with an id matching '${this.commit.shortSha}'`,
            TreeItemCollapsibleState.Expanded
        );
        item.contextValue = ResourceType.Results;
        return item;
    }
}
