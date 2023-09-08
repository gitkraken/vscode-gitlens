import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../../git/gitUri';
import { isStash } from '../../git/models/commit';
import type { GitLog } from '../../git/models/log';
import { configuration } from '../../system/configuration';
import { gate } from '../../system/decorators/gate';
import { debug } from '../../system/decorators/log';
import { map } from '../../system/iterable';
import type { Deferred } from '../../system/promise';
import { cancellable, defer, PromiseCancelledError } from '../../system/promise';
import type { ViewsWithCommits } from '../viewBase';
import { AutolinkedItemsNode } from './autolinkedItemsNode';
import { CommitNode } from './commitNode';
import { LoadMoreNode } from './common';
import { insertDateMarkers } from './helpers';
import type { FilesQueryResults } from './resultsFilesNode';
import { ResultsFilesNode } from './resultsFilesNode';
import { StashNode } from './stashNode';
import type { PageableViewNode } from './viewNode';
import { ContextValues, getViewNodeId, ViewNode } from './viewNode';

export interface CommitsQueryResults {
	readonly label: string;
	readonly log: GitLog | undefined;
	readonly hasMore: boolean;
	more?(limit: number | undefined): Promise<void>;
}

export class ResultsCommitsNode<View extends ViewsWithCommits = ViewsWithCommits>
	extends ViewNode<View>
	implements PageableViewNode
{
	limit: number | undefined;

	constructor(
		view: View,
		protected override readonly parent: ViewNode,
		public readonly repoPath: string,
		private _label: string,
		private readonly _results: {
			query: (limit: number | undefined) => Promise<CommitsQueryResults>;
			comparison?: { ref1: string; ref2: string };
			deferred?: boolean;
			direction?: 'ahead' | 'behind';
			files?: {
				ref1: string;
				ref2: string;
				query: () => Promise<FilesQueryResults>;
			};
		},
		private readonly _options: { description?: string; expand?: boolean } = undefined!,
		splatted?: boolean,
	) {
		super(GitUri.fromRepoPath(repoPath), view, parent);

		if (_results.direction != null) {
			this.updateContext({ branchStatusUpstreamType: _results.direction });
		}
		this._uniqueId = getViewNodeId('results-commits', this.context);
		this.limit = this.view.getNodeLastKnownLimit(this);

		this._options = { expand: true, ..._options };
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

	private _onChildrenCompleted: Deferred<void> | undefined;

	async getChildren(): Promise<ViewNode[]> {
		this._onChildrenCompleted?.cancel();
		this._onChildrenCompleted = defer<void>();

		const { log } = await this.getCommitsQueryResults();
		if (log == null) return [];

		const [getBranchAndTagTips] = await Promise.all([
			this.view.container.git.getBranchesAndTagsTipsFn(this.uri.repoPath),
		]);

		const children: ViewNode[] = [
			new AutolinkedItemsNode(this.view, this, this.uri.repoPath!, log, this._expandAutolinks),
		];
		this._expandAutolinks = false;

		const { files } = this._results;
		if (files != null) {
			children.push(
				new ResultsFilesNode(
					this.view,
					this,
					this.uri.repoPath!,
					files.ref1,
					files.ref2,
					files.query,
					this._results.direction,
					{
						expand: false,
					},
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

		this._onChildrenCompleted.fulfill();
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
				({ label, log } = await cancellable(this.getCommitsQueryResults(), 100));
				state =
					log == null || log.count === 0
						? TreeItemCollapsibleState.None
						: this._options.expand || log.count === 1
						? TreeItemCollapsibleState.Expanded
						: TreeItemCollapsibleState.Collapsed;
			} catch (ex) {
				if (ex instanceof PromiseCancelledError) {
					setTimeout(async () => {
						void (await ex.promise);
						try {
							await this._onChildrenCompleted?.promise;
						} catch {}

						setTimeout(() => void this.triggerChange(false), 1);
					}, 1);
				}

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
		if (results == null || !results.hasMore) return;

		if (context != null && 'expandAutolinks' in context) {
			this._expandAutolinks = Boolean(context.expandAutolinks);
		}
		await results.more?.(limit ?? this.view.config.pageItemLimit);

		this.limit = results.log?.count;

		void this.triggerChange(false);
	}
}
