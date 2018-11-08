'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitLogCommit } from '../../git/gitService';
import { ResultsView } from '../resultsView';
import { CommitNode } from './commitNode';
import { ResourceType, ViewNode } from './viewNode';

export class ResultsCommitNode extends ViewNode {
    constructor(
        view: ResultsView,
        public readonly commit: GitLogCommit
    ) {
        super(commit.toGitUri(), view);
    }

    getChildren(): ViewNode[] {
        return [new CommitNode(this.view, this, this.commit)];
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
