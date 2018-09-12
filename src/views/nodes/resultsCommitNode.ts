'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitLogCommit } from '../../git/gitService';
import { ResultsExplorer } from '../resultsExplorer';
import { CommitNode } from './commitNode';
import { ExplorerNode, ResourceType } from './explorerNode';

export class ResultsCommitNode extends ExplorerNode {
    constructor(
        public readonly commit: GitLogCommit,
        public readonly explorer: ResultsExplorer
    ) {
        super(commit.toGitUri(), undefined);
    }

    getChildren(): ExplorerNode[] {
        return [new CommitNode(this.commit, this, this.explorer)];
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
