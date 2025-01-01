import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../../git/gitUri';
import { isStash } from '../../git/models/commit';
import type { GitRevisionRange } from '../../git/models/revision';
import type { CommitsQueryResults, FilesQueryResults } from '../../git/queryResults';
import { gate } from '../../system/decorators/gate';
import { debug } from '../../system/decorators/log';
import { map } from '../../system/iterable';
import type { Deferred } from '../../system/promise';
import { defer, pauseOnCancelOrTimeout } from '../../system/promise';
import { configuration } from '../../system/vscode/configuration';
import type { ViewsWithCommits } from '../viewBase';
import type { PageableViewNode } from './abstract/viewNode';
import { ContextValues, getViewNodeId, ViewNode } from './abstract/viewNode';
import { AutolinkedItemsNode } from './autolinkedItemsNode';
import { CommitNode } from './commitNode';
import { LoadMoreNode, MessageNode } from './common';
import { ContributorsNode } from './contributorsNode';
import { insertDateMarkers } from './helpers';
import { ResultsFilesNode } from './resultsFilesNode';
import { StashNode } from './stashNode';

interface Options {
	autolinks: boolean;
	expand: boolean;
	description?: string;
}

export class ResultsCommitsNode<View extends ViewsWithCommits = ViewsWithCommits>
	extends ViewNode<'results-commits', View>
	implements PageableViewNode
{
	limit: number | undefined;

	private readonly _options: Options;

	constructor(
		view: View,
		protected override readonly parent: ViewNode,
		public readonly repoPath: string,
		private _label: string,
		private readonly _results: {
			query: (limit: number | undefined) => Promise<CommitsQueryResults>;
			comparison?: { ref1: string; ref2: string; range: GitRevisionRange };
			deferred?: boolean;
			direction?: 'ahead' | 'behind';
			files?: {
				ref1: string;
				ref2: string;
				query: () => Promise<FilesQueryResults>;
			};
		},
		options?: Partial<Options>,
		splatted?: boolean,
	) {
		super('results-commits', GitUri.fromRepoPath(repoPath), view, parent);

		if (_results.direction != null) {
			this.updateContext({ branchStatusUpstreamType: _results.direction });
		}
		this._uniqueId = getViewNodeId(this.type, this.context);
		this.limit = this.view.getNodeLastKnownLimit(this);

		this._options = { autolinks: true, expand: true, ...options };
		if (splatted != null) {
			this.splatted = splatted;
		}
	}

	override get id(): string {
		return this._uniqueId;
	}

	get ref1(): string | undefined {
		return this._results.comparison?.ref1;
	}

	get ref2(): string | undefined {
		return this._results.comparison?.ref2;
	}

	private get isComparisonFiltered(): boolean | undefined {
		return this.context.comparisonFiltered;
	}

	private _onChildrenCompleted: Deferred<void> | undefined;

	async getChildren(): Promise<ViewNode[]> {
		this._onChildrenCompleted?.cancel();
		this._onChildrenCompleted = defer<void>();

		const { log } = await this.getCommitsQueryResults();
		if (log == null) {
			this._onChildrenCompleted?.fulfill();
			return [new MessageNode(this.view, this, 'No results found')];
		}

		const [getBranchAndTagTips] = await Promise.all([
			this.view.container.git.getBranchesAndTagsTipsLookup(this.uri.repoPath),
		]);

		const children: ViewNode[] = [];
		if (this._options.autolinks) {
			children.push(new AutolinkedItemsNode(this.view, this, this.uri.repoPath!, log, this._expandAutolinks));
		}
		this._expandAutolinks = false;

		if (this._results.comparison?.range && this.view.config.showComparisonContributors) {
			children.push(
				new ContributorsNode(
					this.uri,
					this.view,
					this,
					this.view.container.git.getRepository(this.uri.repoPath!)!,
					{
						icon: false,
						ref: this._results.comparison?.range,
						stats: this.view.config.showContributorsStatistics,
					},
				),
			);
		}

		const { files } = this._results;
		// Can't support showing files when commits are filtered
		if (files != null && !this.isComparisonFiltered) {
			children.push(
				new ResultsFilesNode(
					this.view,
					this,
					this.uri.repoPath!,
					files.ref1,
					files.ref2,
					files.query,
					this._results.direction,
					{ expand: false },
				),
			);
		}

		const options = { expand: this._options.expand && log.count === 1 };

		children.push(
			...insertDateMarkers(
				map(log.commits.values(), c =>
					isStash(c)
						? new StashNode(this.view, this, c, { icon: true })
						: new CommitNode(this.view, this, c, undefined, undefined, getBranchAndTagTips, options),
				),
				this,
				undefined,
				{ show: log.count > 1 },
			),
		);

		if (log.hasMore) {
			children.push(new LoadMoreNode(this.view, this, children[children.length - 1]));
		}

		this._onChildrenCompleted?.fulfill();
		return children;
	}

	async getTreeItem(): Promise<TreeItem> {
		let label;
		let state;

		if (this._results.deferred) {
			label = this._label;
			state = TreeItemCollapsibleState.Collapsed;
		} else {
			let log;

			const result = await pauseOnCancelOrTimeout(this.getCommitsQueryResults(), undefined, 100);
			if (!result.paused) {
				({ label, log } = result.value);
				state =
					log == null || log.count === 0
						? TreeItemCollapsibleState.None
						: this._options.expand //|| log.count === 1
						  ? TreeItemCollapsibleState.Expanded
						  : TreeItemCollapsibleState.Collapsed;
			} else {
				queueMicrotask(async () => {
					try {
						await this._onChildrenCompleted?.promise;
					} catch {
						return;
					}

					void (await result.value);
					this.view.triggerNodeChange(this.parent);
				});

				// Need to use Collapsed before we have results or the item won't show up in the view until the children are awaited
				// https://github.com/microsoft/vscode/issues/54806 & https://github.com/microsoft/vscode/issues/62214
				state = TreeItemCollapsibleState.Collapsed;
			}
		}

		const item = new TreeItem(label ?? this._label, state);
		item.id = this.id;
		item.contextValue =
			this._results.comparison != null ? ContextValues.CompareResultsCommits : ContextValues.SearchResultsCommits;
		item.description = this._options.description;

		return item;
	}

	@gate()
	@debug()
	override refresh(reset: boolean = false) {
		if (reset) {
			this._commitsQueryResults = undefined;
			this._commitsQueryResultsPromise = undefined;
			void this.getCommitsQueryResults();
		}
	}

	private _commitsQueryResultsPromise: Promise<CommitsQueryResults> | undefined;
	private async getCommitsQueryResults() {
		if (this._commitsQueryResultsPromise == null) {
			this._commitsQueryResultsPromise = this._results.query(
				this.limit ?? configuration.get('advanced.maxSearchItems'),
			);
			const results = await this._commitsQueryResultsPromise;
			this._commitsQueryResults = results;

			this._hasMore = results.hasMore;

			if (this._results.deferred) {
				this._results.deferred = false;

				void this.parent.triggerChange(false);
			}
		}

		return this._commitsQueryResultsPromise;
	}

	private _commitsQueryResults: CommitsQueryResults | undefined;
	private maybeGetCommitsQueryResults(): CommitsQueryResults | undefined {
		return this._commitsQueryResults;
	}

	private _hasMore = true;
	get hasMore() {
		return this._hasMore;
	}

	private _expandAutolinks: boolean = false;
	async loadMore(limit?: number, context?: Record<string, unknown>): Promise<void> {
		const results = await this.getCommitsQueryResults();
		if (!results?.hasMore) return;

		if (context != null && 'expandAutolinks' in context) {
			this._expandAutolinks = Boolean(context.expandAutolinks);
		}
		await results.more?.(limit ?? this.view.config.pageItemLimit);

		this.limit = results.log?.count;

		void this.triggerChange(false);
	}
}
