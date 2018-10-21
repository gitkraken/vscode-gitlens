'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitLog, GitUri } from '../../git/gitService';
import { Iterables } from '../../system';
import { ResultsView } from '../resultsView';
import { CommitNode } from './commitNode';
import { ShowMoreNode } from './common';
import { PageableViewNode, ResourceType, ViewNode } from './viewNode';

export interface CommitsQueryResults {
    label: string;
    log: GitLog | undefined;
}

export class ResultsCommitsNode extends ViewNode implements PageableViewNode {
    readonly supportsPaging: boolean = true;
    maxCount: number | undefined;

    constructor(
        public readonly repoPath: string,
        private readonly _commitsQuery: (maxCount: number | undefined) => Promise<CommitsQueryResults>,
        parent: ViewNode | undefined,
        public readonly view: ResultsView,
        private readonly _contextValue: ResourceType = ResourceType.ResultsCommits
    ) {
        super(GitUri.fromRepoPath(repoPath), parent);
    }

    async getChildren(): Promise<ViewNode[]> {
        const { log } = await this.getCommitsQueryResults();
        if (log === undefined) return [];

        const children: (CommitNode | ShowMoreNode)[] = [
            ...Iterables.map(log.commits.values(), c => new CommitNode(c, this, this.view))
        ];

        if (log.truncated) {
            children.push(new ShowMoreNode('Results', this, this.view));
        }

        return children;
    }

    async getTreeItem(): Promise<TreeItem> {
        const { label, log } = await this.getCommitsQueryResults();

        const item = new TreeItem(
            label,
            log && log.count > 0 ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.None
        );
        item.contextValue = this._contextValue;

        return item;
    }

    refresh() {
        this._commitsQueryResults = this._commitsQuery(this.maxCount);
    }

    private _commitsQueryResults: Promise<CommitsQueryResults> | undefined;

    private getCommitsQueryResults() {
        if (this._commitsQueryResults === undefined) {
            this._commitsQueryResults = this._commitsQuery(this.maxCount);
        }

        return this._commitsQueryResults;
    }
}
