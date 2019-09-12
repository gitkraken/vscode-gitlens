'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { SearchCommitsCommandArgs } from '../../commands';
import { Commands } from '../../commands/common';
import { ViewWithFiles } from '../viewBase';
import { CommitsQueryResults, ResultsCommitsNode } from './resultsCommitsNode';
import { ResourceType, ViewNode } from './viewNode';
import { RepositoryNode } from './repositoryNode';
import { SearchPattern } from '../../git/gitService';

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
		view: ViewWithFiles,
		parent: ViewNode,
		repoPath: string,
		public readonly search: SearchPattern,
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
		return SearchResultsCommitsNode.getId(this.repoPath, this.search, this._instanceId);
	}

	get type(): ResourceType {
		return ResourceType.SearchResults;
	}

	async getTreeItem(): Promise<TreeItem> {
		const item = await super.getTreeItem();

		if (item.collapsibleState === TreeItemCollapsibleState.None) {
			const args: SearchCommitsCommandArgs = {
				search: this.search,
				prefillOnly: true,
				showInView: true
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
