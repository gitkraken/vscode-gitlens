'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { SearchCommitsCommandArgs } from '../../commands';
import { Commands } from '../../commands/common';
import { GitRepoSearchBy } from '../../git/gitService';
import { ViewWithFiles } from '../viewBase';
import { CommitsQueryResults, ResultsCommitsNode } from './resultsCommitsNode';
import { ResourceType, ViewNode } from './viewNode';

export class SearchResultsCommitsNode extends ResultsCommitsNode {
    constructor(
        view: ViewWithFiles,
        parent: ViewNode,
        repoPath: string,
        public readonly search: string,
        public readonly searchBy: GitRepoSearchBy,
        label: string,
        commitsQuery: (maxCount: number | undefined) => Promise<CommitsQueryResults>,
        _querying = true
    ) {
        super(view, parent, repoPath, label, commitsQuery, _querying, true);
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
        item.id = undefined;

        return item;
    }
}
