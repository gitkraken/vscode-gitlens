'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { SearchCommitsCommandArgs } from '../../commands';
import { Commands } from '../../commands/common';
import { ViewWithFiles } from '../viewBase';
import { CommitsQueryResults, ResultsCommitsNode } from './resultsCommitsNode';
import { ResourceType, ViewNode } from './viewNode';
import { SearchPattern } from '../../git/gitService';

let instanceId = 0;

export class SearchResultsCommitsNode extends ResultsCommitsNode {
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
		return `gitlens:repository(${this.repoPath}):search(${this.search && this.search.pattern}|${
			this.search && this.search.matchAll ? 'A' : ''
		}${this.search && this.search.matchCase ? 'C' : ''}${
			this.search && this.search.matchRegex ? 'R' : ''
		}):commits|${this._instanceId}`;
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
