import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../../git/gitUri';
import type { SuggestedChangesQueryResults } from '../../git/queryResults';
import { gate } from '../../system/decorators/gate';
import { debug } from '../../system/decorators/log';
import type { ViewsWithCommits } from '../viewBase';
import { CacheableChildrenViewNode } from './abstract/cacheableChildrenViewNode';
import type { ViewNode } from './abstract/viewNode';
import { getViewNodeId } from './abstract/viewNode';
import { MessageNode } from './common';
import type { DraftNode } from './draftNode';
import { ResultsSuggestedChangeNode } from './resultsSuggestedChangeNode';

export class ResultsSuggestedChangesNode extends CacheableChildrenViewNode<
	'results-suggested-changes',
	ViewsWithCommits,
	DraftNode
> {
	constructor(
		view: ViewsWithCommits,
		protected override parent: ViewNode,
		public readonly repoPath: string,
		private readonly _suggestedChangesQuery: () => Promise<SuggestedChangesQueryResults>,
	) {
		super('results-suggested-changes', GitUri.fromRepoPath(repoPath), view, parent);

		this._uniqueId = getViewNodeId(this.type, this.context);
	}

	override get id(): string {
		return this._uniqueId;
	}

	async getChildren(): Promise<ViewNode[]> {
		const results = await this.getSuggestedChangesQueryResults();
		const drafts = results.drafts;
		return !drafts?.length
			? [new MessageNode(this.view, this, 'No code suggestions')]
			: drafts.map(d => new ResultsSuggestedChangeNode(this.uri, this.view, this, d));
	}

	getTreeItem(): TreeItem {
		return new TreeItem('Code Suggestions', TreeItemCollapsibleState.Collapsed);
	}

	@gate()
	@debug()
	override refresh(reset: boolean = false) {
		if (!reset) return;
		this._suggestedChangesQueryResults = this._suggestedChangesQuery();
	}

	private _suggestedChangesQueryResults: Promise<SuggestedChangesQueryResults> | undefined;

	private async getSuggestedChangesQueryResults() {
		if (this._suggestedChangesQueryResults === undefined) {
			this._suggestedChangesQueryResults = this._suggestedChangesQuery();
		}

		const results = await this._suggestedChangesQueryResults;
		if (results.drafts == null) {
			return results;
		}

		return results;
	}
}
