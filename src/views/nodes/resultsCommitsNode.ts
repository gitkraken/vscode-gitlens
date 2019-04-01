'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Container } from '../../container';
import { GitLog, GitUri } from '../../git/gitService';
import { Iterables } from '../../system';
import { ViewWithFiles } from '../viewBase';
import { CommitNode } from './commitNode';
import { ShowMoreNode } from './common';
import { getBranchesAndTagTipsFn, insertDateMarkers } from './helpers';
import { PageableViewNode, ResourceType, ViewNode } from './viewNode';

export interface CommitsQueryResults {
    label: string;
    log: GitLog | undefined;
}

export class ResultsCommitsNode extends ViewNode<ViewWithFiles> implements PageableViewNode {
    readonly supportsPaging: boolean = true;
    maxCount: number | undefined;

    constructor(
        view: ViewWithFiles,
        parent: ViewNode,
        public readonly repoPath: string,
        private readonly _commitsQuery: (maxCount: number | undefined) => Promise<CommitsQueryResults>
    ) {
        super(GitUri.fromRepoPath(repoPath), view, parent);
    }

    get type(): ResourceType {
        return ResourceType.ResultsCommits;
    }

    async getChildren(): Promise<ViewNode[]> {
        const { log } = await this.getCommitsQueryResults();
        if (log === undefined) return [];

        const getBranchAndTagTips = await getBranchesAndTagTipsFn(this.uri.repoPath);
        const children = [
            ...insertDateMarkers(
                Iterables.map(
                    log.commits.values(),
                    c => new CommitNode(this.view, this, c, undefined, getBranchAndTagTips)
                ),
                this
            )
        ];

        if (log.truncated) {
            children.push(new ShowMoreNode(this.view, this, 'Results', children[children.length - 1]));
        }

        return children;
    }

    async getTreeItem(): Promise<TreeItem> {
        const { label, log } = await this.getCommitsQueryResults();

        let description;
        if ((await Container.git.getRepositoryCount()) > 1) {
            const repo = await Container.git.getRepository(this.repoPath);
            description = (repo && repo.formattedName) || this.repoPath;
        }

        const item = new TreeItem(
            label,
            log && log.count > 0 ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None
        );
        item.contextValue = this.type;
        item.description = description;

        return item;
    }

    refresh() {
        this._commitsQueryResults = this._commitsQuery(this.maxCount);
    }

    private _commitsQueryResults: Promise<CommitsQueryResults> | undefined;

    protected getCommitsQueryResults() {
        if (this._commitsQueryResults === undefined) {
            this._commitsQueryResults = this._commitsQuery(this.maxCount);
        }

        return this._commitsQueryResults;
    }
}
