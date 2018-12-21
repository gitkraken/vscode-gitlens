'use strict';
import { TreeItem } from 'vscode';
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
        commitsQuery: (maxCount: number | undefined) => Promise<CommitsQueryResults>
    ) {
        super(view, parent, repoPath, commitsQuery);
    }

    get type(): ResourceType {
        return ResourceType.SearchResults;
    }

    async getTreeItem(): Promise<TreeItem> {
        const { log } = await super.getCommitsQueryResults();

        const item = await super.getTreeItem();

        if (log == null || log.count === 0) {
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
