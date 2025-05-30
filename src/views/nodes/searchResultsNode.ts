import type { TreeItem } from 'vscode';
import { ThemeIcon } from 'vscode';
import { md5 } from '@env/crypto';
import { executeGitCommand } from '../../git/actions';
import { GitUri } from '../../git/gitUri';
import type { GitLog } from '../../git/models/log';
import type { SearchQuery, StoredSearchQuery } from '../../git/search';
import { getSearchQueryComparisonKey, getStoredSearchQuery } from '../../git/search';
import { gate } from '../../system/decorators/gate';
import { debug, log } from '../../system/decorators/log';
import { pluralize } from '../../system/string';
import type { SearchAndCompareView } from '../searchAndCompareView';
import { RepositoryNode } from './repositoryNode';
import type { CommitsQueryResults } from './resultsCommitsNode';
import { ResultsCommitsNode } from './resultsCommitsNode';
import type { PageableViewNode } from './viewNode';
import { ContextValues, ViewNode } from './viewNode';

let instanceId = 0;

interface SearchQueryResults {
	readonly label: string;
	readonly log: GitLog | undefined;
	readonly hasMore: boolean;
	more?(limit: number | undefined): Promise<void>;
}

export class SearchResultsNode extends ViewNode<SearchAndCompareView> implements PageableViewNode {
	static key = ':search-results';
	static getId(repoPath: string, search: SearchQuery | undefined, instanceId: number): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}(${
			search == null ? '?' : getSearchQueryComparisonKey(search)
		}):${instanceId}`;
	}

	static getPinnableId(repoPath: string, search: SearchQuery | StoredSearchQuery) {
		return md5(`${repoPath}|${getSearchQueryComparisonKey(search)}`, 'base64');
	}

	private _instanceId: number;
	constructor(
		view: SearchAndCompareView,
		parent: ViewNode,
		public readonly repoPath: string,
		search: SearchQuery,
		private _labels: {
			label: string;
			queryLabel:
				| string
				| {
						label: string;
						resultsType?: { singular: string; plural: string };
				  };
			resultsType?: { singular: string; plural: string };
		},
		private _searchQueryOrLog?:
			| ((limit: number | undefined) => Promise<CommitsQueryResults>)
			| Promise<GitLog | undefined>
			| GitLog
			| undefined,
		private _pinned: number = 0,
	) {
		super(GitUri.fromRepoPath(repoPath), view, parent);

		this._search = search;
		this._instanceId = instanceId++;
		this._order = Date.now();
	}

	override get id(): string {
		return SearchResultsNode.getId(this.repoPath, this.search, this._instanceId);
	}

	get canDismiss(): boolean {
		return !this.pinned;
	}

	private readonly _order: number = Date.now();
	get order(): number {
		return this._pinned || this._order;
	}

	get pinned(): boolean {
		return this._pinned !== 0;
	}

	private _search: SearchQuery;
	get search(): SearchQuery {
		return this._search;
	}

	private _resultsNode: ResultsCommitsNode | undefined;
	private ensureResults() {
		if (this._resultsNode == null) {
			let deferred;
			if (this._searchQueryOrLog == null) {
				deferred = true;
				this._searchQueryOrLog = this.getSearchQuery({
					label: this._labels.queryLabel,
				});
			} else if (typeof this._searchQueryOrLog !== 'function') {
				this._searchQueryOrLog = this.getSearchQuery(
					{
						label: this._labels.queryLabel,
					},
					this._searchQueryOrLog,
				);
			}

			this._resultsNode = new ResultsCommitsNode(
				this.view,
				this,
				this.repoPath,
				this._labels.label,
				{
					query: this._searchQueryOrLog,
					deferred: deferred,
				},
				{
					expand: !this.pinned,
				},
				true,
			);
		}

		return this._resultsNode;
	}

	async getChildren(): Promise<ViewNode[]> {
		return this.ensureResults().getChildren();
	}

	async getTreeItem(): Promise<TreeItem> {
		const item = await this.ensureResults().getTreeItem();
		item.id = this.id;
		item.contextValue = `${ContextValues.SearchResults}${this._pinned ? '+pinned' : ''}`;
		if (this.view.container.git.repositoryCount > 1) {
			const repo = this.view.container.git.getRepository(this.repoPath);
			item.description = repo?.formattedName ?? this.repoPath;
		}
		if (this._pinned) {
			item.iconPath = new ThemeIcon('pinned');
		}

		return item;
	}

	get hasMore() {
		return this.ensureResults().hasMore;
	}

	async loadMore(limit?: number) {
		return this.ensureResults().loadMore(limit);
	}

	async edit(search?: {
		pattern: SearchQuery;
		labels: {
			label: string;
			queryLabel:
				| string
				| {
						label: string;
						resultsType?: { singular: string; plural: string };
				  };
			resultsType?: { singular: string; plural: string };
		};
		log: Promise<GitLog | undefined> | GitLog | undefined;
	}) {
		if (search == null) {
			await executeGitCommand({
				command: 'search',
				prefillOnly: true,
				state: {
					repo: this.repoPath,
					...this.search,
					showResultsInSideBar: this,
				},
			});

			return;
		}

		// Save the current id so we can update it later
		const currentId = this.getPinnableId();

		this._search = search.pattern;
		this._labels = search.labels;
		this._searchQueryOrLog = search.log;
		this._resultsNode = undefined;

		// If we were pinned, remove the existing pin and save a new one
		if (this.pinned) {
			await this.view.updatePinned(currentId);
			await this.updatePinned();
		}

		void this.triggerChange(false);
		queueMicrotask(() => this.view.reveal(this, { expand: true, focus: true, select: true }));
	}

	@gate()
	@debug()
	override refresh(reset: boolean = false) {
		this._resultsNode?.refresh(reset);
	}

	@log()
	async pin() {
		if (this.pinned) return;

		this._pinned = Date.now();
		await this.updatePinned();

		queueMicrotask(() => this.view.reveal(this, { focus: true, select: true }));
	}

	@log()
	async unpin() {
		if (!this.pinned) return;

		this._pinned = 0;
		await this.view.updatePinned(this.getPinnableId());

		queueMicrotask(() => this.view.reveal(this, { focus: true, select: true }));
	}

	private getPinnableId() {
		return SearchResultsNode.getPinnableId(this.repoPath, this.search);
	}

	private getSearchLabel(
		label:
			| string
			| {
					label: string;
					resultsType?: { singular: string; plural: string };
			  },
		log: GitLog | undefined,
	): string {
		if (typeof label === 'string') return label;

		const count = log?.count ?? 0;

		const resultsType =
			label.resultsType === undefined ? { singular: 'result', plural: 'results' } : label.resultsType;

		return `${pluralize(resultsType.singular, count, {
			format: c => (log?.hasMore ? `${c}+` : undefined),
			plural: resultsType.plural,
			zero: 'No',
		})} ${label.label}`;
	}

	private getSearchQuery(
		options: {
			label:
				| string
				| {
						label: string;
						resultsType?: { singular: string; plural: string };
				  };
		},
		log?: Promise<GitLog | undefined> | GitLog,
	): (limit: number | undefined) => Promise<SearchQueryResults> {
		let useCacheOnce = true;

		return async (limit: number | undefined) => {
			log = await (log ?? this.view.container.git.richSearchCommits(this.repoPath, this.search));

			if (!useCacheOnce && log != null && log.query != null) {
				log = await log.query(limit);
			}
			useCacheOnce = false;

			const results: Mutable<SearchQueryResults> = {
				label: this.getSearchLabel(options.label, log),
				log: log,
				hasMore: log?.hasMore ?? false,
			};
			if (results.hasMore) {
				results.more = async (limit: number | undefined) => {
					results.log = (await results.log?.more?.(limit)) ?? results.log;

					results.label = this.getSearchLabel(options.label, results.log);
					results.hasMore = results.log?.hasMore ?? true;
				};
			}

			return results;
		};
	}

	private updatePinned() {
		return this.view.updatePinned(this.getPinnableId(), {
			type: 'search',
			timestamp: this._pinned,
			path: this.repoPath,
			labels: this._labels,
			search: getStoredSearchQuery(this.search),
		});
	}
}
