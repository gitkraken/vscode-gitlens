'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Container } from '../../container';
import { GitLog, GitUri } from '../../git/gitService';
import { debug, gate, Iterables } from '../../system';
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
    readonly supportsPaging = true;
    readonly rememberLastMaxCount = true;
    maxCount: number | undefined = this.view.getNodeLastMaxCount(this);

    constructor(
        view: ViewWithFiles,
        parent: ViewNode,
        public readonly repoPath: string,
        private _label: string,
        private readonly _commitsQuery: (maxCount: number | undefined) => Promise<CommitsQueryResults>,
        private readonly _options: { expand?: boolean; includeDescription?: boolean; querying?: boolean } = {}
    ) {
        super(GitUri.fromRepoPath(repoPath), view, parent);

        this._options = { expand: true, includeDescription: true, querying: true, ..._options };
    }

    get id(): string {
        return `${this.parent!.id}:results:commits`;
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
            children.push(
                new ShowMoreNode(this.view, this, 'Results', log.maxCount, children[children.length - 1], this.maxCount)
            );
        }

        return children;
    }

    async getTreeItem(): Promise<TreeItem> {
        let state;
        let label;
        let log;
        if (this._options.querying) {
            // Need to use Collapsed before we have results or the item won't show up in the view until the children are awaited
            state = TreeItemCollapsibleState.Collapsed;
            label = this._label;

            this.getCommitsQueryResults().then(({ log }) => {
                this._options.querying = false;
                if (log != null) {
                    this.maxCount = log.maxCount;
                }

                this.triggerChange(false);
            });
        }
        else {
            ({ label, log } = await this.getCommitsQueryResults());
            if (log != null) {
                this.maxCount = log.maxCount;
            }

            state = this._options.expand ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed;
            if (log == null || log.count === 0) {
                state = TreeItemCollapsibleState.None;
            }
        }

        let description;
        if (this._options.includeDescription && (await Container.git.getRepositoryCount()) > 1) {
            const repo = await Container.git.getRepository(this.repoPath);
            description = (repo && repo.formattedName) || this.repoPath;
        }

        const item = new TreeItem(label, state);
        item.contextValue = this.type;
        item.description = description;
        item.id = this.id;

        return item;
    }

    @gate()
    @debug()
    refresh(reset: boolean = false) {
        if (!reset) return;

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
