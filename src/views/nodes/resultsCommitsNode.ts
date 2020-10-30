'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { CommitNode } from './commitNode';
import { LoadMoreNode } from './common';
import { Container } from '../../container';
import { GitLog } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { insertDateMarkers } from './helpers';
import { FilesQueryResults, ResultsFilesNode } from './resultsFilesNode';
import { debug, gate, Iterables, Promises } from '../../system';
import { ViewsWithFiles } from '../viewBase';
import { ContextValues, PageableViewNode, ViewNode } from './viewNode';

export interface CommitsQueryResults {
	readonly label: string;
	readonly log: GitLog | undefined;
	readonly hasMore: boolean;
	more?(limit: number | undefined): Promise<void>;
}

export class ResultsCommitsNode<View extends ViewsWithFiles = ViewsWithFiles>
	extends ViewNode<View>
	implements PageableViewNode {
	constructor(
		view: View,
		parent: ViewNode,
		public readonly repoPath: string,
		private _label: string,
		private readonly _results: {
			query: (limit: number | undefined) => Promise<CommitsQueryResults>;
			comparison?: { ref1: string; ref2: string };
			deferred?: boolean;
			files?: {
				ref1: string;
				ref2: string;
				query: () => Promise<FilesQueryResults>;
			};
		},
		private readonly _options: {
			id?: string;
			description?: string;
			expand?: boolean;
		} = {},
		splatted?: boolean,
	) {
		super(GitUri.fromRepoPath(repoPath), view, parent);

		if (splatted != null) {
			this.splatted = splatted;
		}
		this._options = { expand: true, ..._options };
	}

	get ref1(): string | undefined {
		return this._results.comparison?.ref1;
	}

	get ref2(): string | undefined {
		return this._results.comparison?.ref2;
	}

	get id(): string {
		return `${this.parent!.id}:results:commits${this._options.id ? `:${this._options.id}` : ''}`;
	}

	async getChildren(): Promise<ViewNode[]> {
		const { log } = await this.getCommitsQueryResults();
		if (log == null) return [];

		const getBranchAndTagTips = await Container.git.getBranchesAndTagsTipsFn(this.uri.repoPath);
		const children = [];

		const { files } = this._results;
		if (files != null) {
			children.push(
				new ResultsFilesNode(this.view, this, this.uri.repoPath!, files.ref1, files.ref2, files.query, {
					expand: false,
				}),
			);
		}

		const options = { expand: this._options.expand && log.count === 1 };

		children.push(
			...insertDateMarkers(
				Iterables.map(
					log.commits.values(),
					c => new CommitNode(this.view, this, c, undefined, undefined, getBranchAndTagTips, options),
				),
				this,
				undefined,
				{ show: log.count > 1 },
			),
		);

		if (log.hasMore) {
			children.push(new LoadMoreNode(this.view, this, children[children.length - 1]));
		}

		return children;
	}

	async getTreeItem(): Promise<TreeItem> {
		let label;
		let state;

		if (this._results.deferred) {
			label = this._label;
			state = TreeItemCollapsibleState.Collapsed;
		} else {
			try {
				let log;
				({ label, log } = await Promises.cancellable(this.getCommitsQueryResults(), 100));
				state =
					log == null || log.count === 0
						? TreeItemCollapsibleState.None
						: this._options.expand || log.count === 1
						? TreeItemCollapsibleState.Expanded
						: TreeItemCollapsibleState.Collapsed;
			} catch (ex) {
				if (ex instanceof Promises.CancellationError) {
					ex.promise.then(() => this.triggerChange(false));
				}

				// Need to use Collapsed before we have results or the item won't show up in the view until the children are awaited
				// https://github.com/microsoft/vscode/issues/54806 & https://github.com/microsoft/vscode/issues/62214
				state = TreeItemCollapsibleState.Collapsed;
			}
		}

		const item = new TreeItem(label ?? this._label, state);
		item.contextValue =
			this._results.comparison != null ? ContextValues.CompareResultsCommits : ContextValues.SearchResultsCommits;
		item.description = this._options.description;
		item.id = this.id;

		return item;
	}

	@gate()
	@debug()
	refresh(reset: boolean = false) {
		if (reset) {
			this._commitsQueryResults = undefined;
			void this.getCommitsQueryResults();
		}
	}

	private _commitsQueryResults: Promise<CommitsQueryResults> | undefined;
	private async getCommitsQueryResults() {
		if (this._commitsQueryResults == null) {
			this._commitsQueryResults = this._results.query(this.limit ?? Container.config.advanced.maxSearchItems);
			const results = await this._commitsQueryResults;
			this._hasMore = results.hasMore;

			if (this._results.deferred) {
				this._results.deferred = false;

				void this.triggerChange(false);
			}
		}

		return this._commitsQueryResults;
	}

	private _hasMore = true;
	get hasMore() {
		return this._hasMore;
	}

	limit: number | undefined = this.view.getNodeLastKnownLimit(this);
	async loadMore(limit?: number) {
		const results = await this.getCommitsQueryResults();
		if (results == null || !results.hasMore) return;

		await results.more?.(limit ?? this.view.config.pageItemLimit);

		this.limit = results.log?.count;

		void this.triggerChange(false);
	}
}
