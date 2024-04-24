import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../../git/gitUri';
import type { SuggestedChangesQueryResults } from '../../git/queryResults';
import { gate } from '../../system/decorators/gate';
import { debug } from '../../system/decorators/log';
import { cancellable, PromiseCancelledError } from '../../system/promise';
import type { ViewsWithCommits } from '../viewBase';
import { ContextValues, getViewNodeId, ViewNode } from './abstract/viewNode';
import type { Draft } from '../../gk/models/drafts';
import { ResultsSuggestedChangeNode } from './resultsSuggestedChangeNode';

interface Options {
	expand: boolean;
	timeout: false | number;
}

export class ResultsSuggestedChangesNode extends ViewNode<'results-suggested-changes', ViewsWithCommits> {
	private readonly _options: Options;

	constructor(
		view: ViewsWithCommits,
		protected override parent: ViewNode,
		public readonly repoPath: string,
		private readonly _suggestedChangesQuery: () => Promise<SuggestedChangesQueryResults>,
		options?: Partial<Options>,
	) {
		super('results-suggested-changes', GitUri.fromRepoPath(repoPath), view, parent);

		this._uniqueId = getViewNodeId(this.type, this.context);
		this._options = { expand: true, timeout: 100, ...options };
	}

	override get id(): string {
		return this._uniqueId;
	}

	async getChildren(): Promise<ViewNode[]> {
		const results = await this.getSuggestedChangesQueryResults();
		const drafts = results.drafts;
		return drafts?.map(d => new ResultsSuggestedChangeNode(this.view, this, this.repoPath, d)) || [];
	}

	async getTreeItem(): Promise<TreeItem> {
		let description;
		let icon;
		let drafts: Draft[] | undefined;
		let state;
		let tooltip;
		const label = 'Suggested changes';

		try {
			const results = await cancellable(
				this.getSuggestedChangesQueryResults(),
				this._options.timeout === false ? undefined : this._options.timeout,
			);

			drafts = results.drafts;

			if (state === undefined) {
				state =
					drafts == null || drafts.length === 0
						? TreeItemCollapsibleState.None
						: this._options.expand
						  ? TreeItemCollapsibleState.Expanded
						  : TreeItemCollapsibleState.Collapsed;
			}
		} catch (ex) {
			if (ex instanceof PromiseCancelledError) {
				void ex.promise.then(() => queueMicrotask(() => this.triggerChange(false)));
			}

			icon = new ThemeIcon('ellipsis');
			// Need to use Collapsed before we have results or the item won't show up in the view until the children are awaited
			// https://github.com/microsoft/vscode/issues/54806 & https://github.com/microsoft/vscode/issues/62214
			state = TreeItemCollapsibleState.Collapsed;
		}

		const item = new TreeItem(label, state);
		item.description = description;
		item.id = this.id;
		item.iconPath = icon;
		item.contextValue = ContextValues.ResultsFiles;
		item.tooltip = tooltip;

		return item;
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
