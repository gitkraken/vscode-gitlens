'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Commands, SearchCommitsCommandArgs } from '../../commands';
import { ViewsWithFiles } from '../viewBase';
import { CommitsQueryResults, ResultsCommitsNode } from './resultsCommitsNode';
import { ContextValues, ViewNode } from './viewNode';
import { RepositoryNode } from './repositoryNode';
import { SearchPattern } from '../../git/git';

let instanceId = 0;

export class SearchResultsCommitsNode extends ResultsCommitsNode {
	static key = ':search-results';
	static getId(repoPath: string, search: SearchPattern | undefined, instanceId: number): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}(${
			search === undefined ? '?' : SearchPattern.toKey(search)
		}):${instanceId}`;
	}

	private _instanceId: number;

	constructor(
		view: ViewsWithFiles,
		parent: ViewNode,
		repoPath: string,
		public readonly search: SearchPattern,
		label: string,
		commitsQuery: (limit: number | undefined) => Promise<CommitsQueryResults>,
	) {
		super(view, parent, repoPath, label, commitsQuery, {
			expand: true,
			includeDescription: true,
		});

		this._instanceId = instanceId++;
	}

	get id(): string {
		return SearchResultsCommitsNode.getId(this.repoPath, this.search, this._instanceId);
	}

	get type(): ContextValues {
		return ContextValues.SearchResults;
	}

	async getTreeItem(): Promise<TreeItem> {
		const item = await super.getTreeItem();

		if (item.collapsibleState === TreeItemCollapsibleState.None) {
			const args: SearchCommitsCommandArgs = {
				search: this.search,
				prefillOnly: true,
				showResultsInSideBar: true,
			};
			item.command = {
				title: 'Search Commits',
				command: Commands.SearchCommitsInView,
				arguments: [args],
			};
		}

		return item;
	}
}
