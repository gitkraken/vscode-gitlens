'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitLogCommit } from '../../git/gitService';
import { ResultsView } from '../resultsView';
import { CommitNode } from './commitNode';
import { ResourceType, ViewNode } from './viewNode';

export class ResultsCommitNode extends ViewNode {
    constructor(
        public readonly commit: GitLogCommit,
        public readonly view: ResultsView
    ) {
        super(commit.toGitUri(), undefined);
    }

    getChildren(): ViewNode[] {
        return [new CommitNode(this.commit, this, this.view)];
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
