import { md5 } from '@env/crypto';
import type { TreeItem } from 'vscode';
import { ThemeIcon } from 'vscode';
import type { SearchQuery } from '../../constants.search';
import { executeGitCommand } from '../../git/actions';
import { GitUri } from '../../git/gitUri';
import type { GitLog } from '../../git/models/log';
import type { CommitsQueryResults } from '../../git/queryResults';
import { getSearchQueryComparisonKey, getStoredSearchQuery } from '../../git/search';
import { gate } from '../../system/decorators/gate';
import { debug } from '../../system/decorators/log';
import { pluralize } from '../../system/string';
import type { SearchAndCompareView } from '../searchAndCompareView';
import type { PageableViewNode } from './abstract/viewNode';
import { ContextValues, getViewNodeId, ViewNode } from './abstract/viewNode';
import { ResultsCommitsNode } from './resultsCommitsNode';

let instanceId = 0;

interface SearchQueryResults {
	readonly label: string;
	readonly log: GitLog | undefined;
	readonly hasMore: boolean;
	more?(limit: number | undefined): Promise<void>;
}

export class SearchResultsNode extends ViewNode<'search-results', SearchAndCompareView> implements PageableViewNode {
	private _instanceId: number;

	constructor(
		view: SearchAndCompareView,
		protected override readonly parent: ViewNode,
		public readonly repoPath: string,
		private _search: SearchQuery,
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
		private _storedAt: number = 0,
	) {
		super('search-results', GitUri.fromRepoPath(repoPath), view, parent);

		this._instanceId = instanceId++;
		this.updateContext({ searchId: `${getSearchQueryComparisonKey(this._search)}+${this._instanceId}` });
		this._uniqueId = getViewNodeId(this.type, this.context);

		// If this is a new search, save it
		if (this._storedAt === 0) {
			this._storedAt = Date.now();
			void this.store(true).catch();
		}
	}

	override get id(): string {
		return this._uniqueId;
	}

	override toClipboard(): string {
		return this.search.query;
	}

	get order(): number {
		return this._storedAt;
	}

	get search(): SearchQuery {
		return this._search;
	}

	dismiss() {
		void this.remove(true);
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
					expand: false,
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
		item.contextValue = ContextValues.SearchResults;
		if (this.view.container.git.repositoryCount > 1) {
			const repo = this.view.container.git.getRepository(this.repoPath);
			item.description = repo?.formattedName ?? this.repoPath;
		}
		item.iconPath = new ThemeIcon('search');

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
		const currentId = this.getStorageId();

		this._search = search.pattern;
		this._labels = search.labels;
		this._searchQueryOrLog = search.log;
		this._resultsNode = undefined;

		// Remove the existing stored item and save a new one
		await this.replace(currentId, true);

		void this.triggerChange(false);
		queueMicrotask(() => this.view.reveal(this, { expand: true, focus: true, select: true }));
	}

	@gate()
	@debug()
	override refresh(reset: boolean = false) {
		this._resultsNode?.refresh(reset);
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
			label.resultsType === undefined
				? { singular: 'search result', plural: 'search results' }
				: label.resultsType;

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

			if (!useCacheOnce && log?.query != null) {
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

	private getStorageId() {
		return md5(`${this.repoPath}|${getSearchQueryComparisonKey(this.search)}`, 'base64');
	}

	private remove(silent: boolean = false) {
		return this.view.updateStorage(this.getStorageId(), undefined, silent);
	}

	private async replace(id: string, silent: boolean = false) {
		await this.view.updateStorage(id, undefined, silent);
		return this.store(silent);
	}

	private store(silent: boolean = false) {
		return this.view.updateStorage(
			this.getStorageId(),
			{
				type: 'search',
				timestamp: this._storedAt,
				path: this.repoPath,
				labels: this._labels,
				search: getStoredSearchQuery(this.search),
			},
			silent,
		);
	}
}
