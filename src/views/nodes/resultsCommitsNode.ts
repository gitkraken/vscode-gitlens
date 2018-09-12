'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitLog, GitUri } from '../../git/gitService';
import { Iterables } from '../../system';
import { ResultsExplorer } from '../resultsExplorer';
import { CommitNode } from './commitNode';
import { ShowAllNode } from './common';
import { ExplorerNode, PageableExplorerNode, ResourceType } from './explorerNode';

export interface CommitsQueryResults {
    label: string;
    log: GitLog | undefined;
}

export class ResultsCommitsNode extends ExplorerNode implements PageableExplorerNode {
    readonly supportsPaging: boolean = true;
    maxCount: number | undefined;

    constructor(
        public readonly repoPath: string,
        private readonly _commitsQuery: (maxCount: number | undefined) => Promise<CommitsQueryResults>,
        parent: ExplorerNode | undefined,
        public readonly explorer: ResultsExplorer,
        private readonly _contextValue: ResourceType = ResourceType.ResultsCommits
    ) {
        super(GitUri.fromRepoPath(repoPath), parent);
    }

    async getChildren(): Promise<ExplorerNode[]> {
        const { log } = await this.getCommitsQueryResults();
        if (log === undefined) return [];

        const children: (CommitNode | ShowAllNode)[] = [
            ...Iterables.map(log.commits.values(), c => new CommitNode(c, this, this.explorer))
        ];

        if (log.truncated) {
            children.push(new ShowAllNode('Results', this, this.explorer));
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

    async refresh() {
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
