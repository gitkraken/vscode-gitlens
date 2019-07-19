'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { SearchCommitsCommandArgs } from '../../commands';
import { Commands } from '../../commands/common';
import { GitRepoSearchBy } from '../../git/gitService';
import { ViewWithFiles } from '../viewBase';
import { CommitsQueryResults, ResultsCommitsNode } from './resultsCommitsNode';
import { ResourceType, ViewNode } from './viewNode';

let instanceId = 0;

export class SearchResultsCommitsNode extends ResultsCommitsNode {
    private _instanceId: number;

    constructor(
        view: ViewWithFiles,
        parent: ViewNode,
        repoPath: string,
        public readonly search: string,
        public readonly searchBy: GitRepoSearchBy,
        label: string,
        commitsQuery: (maxCount: number | undefined) => Promise<CommitsQueryResults>
    ) {
        super(view, parent, repoPath, label, commitsQuery, {
            expand: true,
            includeDescription: true
        });

        this._instanceId = instanceId++;
    }

    get id(): string {
        return `gitlens:repository(${this.repoPath}):search(${this.searchBy}:${this.search}):commits|${this._instanceId}`;
    }

    get type(): ResourceType {
        return ResourceType.SearchResults;
    }

    async getTreeItem(): Promise<TreeItem> {
        const item = await super.getTreeItem();

        if (item.collapsibleState === TreeItemCollapsibleState.None) {
            const args: SearchCommitsCommandArgs = {
                search: this.search,
                searchBy: this.searchBy,
                prefillOnly: true
            };
            item.command = {
                title: 'Search Commits',
                command: Commands.SearchCommitsInView,
                arguments: [args]
            };
        }

        return item;
    }
}
