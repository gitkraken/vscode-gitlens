import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { TreeViewNodeTypes } from '../../constants.views';
import { GitUri } from '../../git/gitUri';
import { isStash } from '../../git/models/commit';
import type { GitRevisionRange } from '../../git/models/revision';
import type { CommitsQueryResults, FilesQueryResults } from '../../git/queryResults';
import { getChangesForChangelog } from '../../git/utils/-webview/log.utils';
import type { AIGenerateChangelogChanges } from '../../plus/ai/actions/generateChangelog';
import { configuration } from '../../system/-webview/configuration';
import { debug } from '../../system/decorators/log';
import { map } from '../../system/iterable';
import { getLoggableName, Logger } from '../../system/logger';
import { getNewLogScope } from '../../system/logger.scope';
import type { Deferred } from '../../system/promise';
import { defer, pauseOnCancelOrTimeout } from '../../system/promise';
import type { ViewsWithCommits } from '../viewBase';
import type { PageableViewNode } from './abstract/viewNode';
import { ContextValues, getViewNodeId, ViewNode } from './abstract/viewNode';
import { AutolinkedItemsNode } from './autolinkedItemsNode';
import { CommitNode } from './commitNode';
import { LoadMoreNode, MessageNode } from './common';
import { ContributorsNode } from './contributorsNode';
import { ResultsFilesNode } from './resultsFilesNode';
import { StashNode } from './stashNode';
import { insertDateMarkers } from './utils/-webview/node.utils';

interface Options {
	autolinks: boolean;
	expand: boolean;
	description?: string;
}

export class ResultsCommitsNodeBase<Type extends TreeViewNodeTypes, View extends ViewsWithCommits = ViewsWithCommits>
	extends ViewNode<Type, View>
	implements PageableViewNode
{
	limit: number | undefined;

	private readonly _options: Options;

	constructor(
		type: Type,
		view: View,
		protected override readonly parent: ViewNode,
		public readonly repoPath: string,
		private _label: string,
		protected readonly _results: {
			query: (limit: number | undefined) => Promise<CommitsQueryResults>;
			comparison?: { ref1: string; ref2: string; range: GitRevisionRange };
			deferred?: boolean;
			direction?: 'ahead' | 'behind';
			files?: { ref1: string; ref2: string; query: () => Promise<FilesQueryResults> };
		},
		options?: Partial<Options>,
	) {
		super(type, GitUri.fromRepoPath(repoPath), view, parent);

		if (_results.direction != null) {
			this.updateContext({ branchStatusUpstreamType: _results.direction, repoPath: repoPath });
		}
		this._uniqueId = getViewNodeId(this.type, this.context);
		this.limit = this.view.getNodeLastKnownLimit(this);

		this._options = { autolinks: true, expand: true, ...options };
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
		if (!log?.commits.size) {
			this._onChildrenCompleted?.fulfill();
			return [new MessageNode(this.view, this, 'No results found')];
		}

		const getBranchAndTagTips = await this.view.container.git
			.getRepositoryService(this.uri.repoPath!)
			.getBranchesAndTagsTipsLookup();

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

		const allowFilteredFiles = log.searchFilters?.files ?? false;

		children.push(
			...insertDateMarkers(
				map(log.commits.values(), c =>
					isStash(c)
						? new StashNode(this.view, this, c, { allowFilteredFiles: allowFilteredFiles, icon: true })
						: new CommitNode(this.view, this, c, undefined, undefined, getBranchAndTagTips, {
								allowFilteredFiles: allowFilteredFiles,
								expand: this._options.expand && log.count === 1,
							}),
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
				state = this._options.expand ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed;

				({ label, log } = result.value);

				state = !log?.commits.size
					? TreeItemCollapsibleState.None
					: this._options.expand //|| log.count === 1
						? TreeItemCollapsibleState.Expanded
						: TreeItemCollapsibleState.Collapsed;
			} else {
				queueMicrotask(async () => {
					const scope = getNewLogScope(`${getLoggableName(this)}.getTreeItem`, true);
					try {
						if (this._onChildrenCompleted?.promise != null) {
							const timeout = new Promise<void>(resolve => {
								setTimeout(() => {
									Logger.error(undefined, scope, 'onChildrenCompleted promise timed out after 30s');
									resolve();
								}, 30000); // 30 second timeout
							});

							await Promise.race([this._onChildrenCompleted.promise, timeout]);
						}

						void (await result.value);
						this.view.triggerNodeChange(this.parent);
					} catch (ex) {
						Logger.error(ex, scope, 'Failed awaiting children completion');
					}
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

	@debug()
	override refresh(reset: boolean = false): void {
		if (reset) {
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

			this._hasMore = results.hasMore;

			if (this._results.deferred) {
				this._results.deferred = false;

				void this.parent.triggerChange(false);
			}
		}

		return this._commitsQueryResultsPromise;
	}

	private _hasMore = true;
	get hasMore(): boolean {
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

	async getChangesForChangelog(): Promise<AIGenerateChangelogChanges> {
		const range: AIGenerateChangelogChanges['range'] = {
			base: { ref: this.ref1!, label: `\`${this.ref1}\`` },
			head: { ref: this.ref2!, label: `\`${this.ref2}\`` },
		};

		const { log } = await this.getCommitsQueryResults();
		if (log == null) return { changes: [], range: range };

		return getChangesForChangelog(this.view.container, range, log);
	}
}

export class ResultsCommitsNode<View extends ViewsWithCommits = ViewsWithCommits> extends ResultsCommitsNodeBase<
	'results-commits',
	View
> {
	constructor(
		view: View,
		parent: ViewNode,
		repoPath: string,
		label: string,
		results: {
			query: (limit: number | undefined) => Promise<CommitsQueryResults>;
			comparison?: { ref1: string; ref2: string; range: GitRevisionRange };
			deferred?: boolean;
			direction?: 'ahead' | 'behind';
			files?: { ref1: string; ref2: string; query: () => Promise<FilesQueryResults> };
		},
		options?: Partial<Options>,
	) {
		super('results-commits', view, parent, repoPath, label, results, options);
	}
}
