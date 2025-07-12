import type { TreeItem } from 'vscode';
import { ThemeIcon } from 'vscode';
import { md5 } from '@env/crypto';
import type { SearchQuery } from '../../constants.search';
import { executeGitCommand } from '../../git/actions';
import type { GitLog } from '../../git/models/log';
import type { CommitsQueryResults } from '../../git/queryResults';
import { getSearchQueryComparisonKey, getStoredSearchQuery } from '../../git/search';
import { pluralize } from '../../system/string';
import type { SearchAndCompareView } from '../searchAndCompareView';
import type { ViewNode } from './abstract/viewNode';
import { ContextValues, getViewNodeId } from './abstract/viewNode';
import { ResultsCommitsNodeBase } from './resultsCommitsNode';

interface SearchQueryResults {
	readonly label: string;
	readonly log: GitLog | undefined;
	readonly hasMore: boolean;
	more?(limit: number | undefined): Promise<void>;
}

export class SearchResultsNode extends ResultsCommitsNodeBase<'search-results', SearchAndCompareView> {
	private _search: SearchQuery;
	private _labels: {
		label: string;
		queryLabel: string | { label: string; resultsType?: { singular: string; plural: string } };
		resultsType?: { singular: string; plural: string };
	};
	private _storedAt: number;

	constructor(
		view: SearchAndCompareView,
		parent: ViewNode,
		repoPath: string,
		search: SearchQuery,
		labels: {
			label: string;
			queryLabel: string | { label: string; resultsType?: { singular: string; plural: string } };
			resultsType?: { singular: string; plural: string };
		},
		searchQueryOrLog?:
			| ((limit: number | undefined) => Promise<CommitsQueryResults>)
			| Promise<GitLog | undefined>
			| GitLog
			| undefined,
		storedAt: number = 0,
	) {
		const query = createSearchQuery(view, repoPath, search, labels, searchQueryOrLog);
		const deferred = searchQueryOrLog == null;

		super(
			'search-results',
			view,
			parent,
			repoPath,
			labels.label,
			{ query: query, deferred: deferred },
			{ expand: false },
		);

		this._search = search;
		this._labels = labels;
		this._storedAt = storedAt;

		this.updateContext({ searchId: getSearchQueryComparisonKey(this._search) });
		this._uniqueId = getViewNodeId('search-results', this.context);

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

	dismiss(): void {
		void this.remove(true);
	}

	override async getTreeItem(): Promise<TreeItem> {
		const item = await super.getTreeItem();
		item.id = this.id;
		item.contextValue = ContextValues.SearchResults;
		if (this.view.container.git.repositoryCount > 1) {
			const repo = this.view.container.git.getRepository(this.repoPath);
			item.description = repo?.name ?? this.repoPath;
		}
		item.iconPath = new ThemeIcon('search');

		return item;
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
	}): Promise<void> {
		if (search == null) {
			await executeGitCommand({
				command: 'search',
				prefillOnly: true,
				state: { repo: this.repoPath, ...this.search, showResultsInSideBar: this },
			});

			return;
		}

		// Save the current id so we can update it later
		const currentId = this.getStorageId();

		this._search = search.pattern;
		this._labels = search.labels;
		this._results.query = createSearchQuery(this.view, this.repoPath, this._search, this._labels);
		this._results.deferred = true;

		// Remove the existing stored item and save a new one
		await this.replace(currentId, true);

		void this.triggerChange(true);
		queueMicrotask(() => this.view.reveal(this, { expand: true, focus: true, select: true }));
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

function createSearchQuery(
	view: SearchAndCompareView,
	repoPath: string,
	search: SearchQuery,
	labels: {
		label: string;
		queryLabel: string | { label: string; resultsType?: { singular: string; plural: string } };
		resultsType?: { singular: string; plural: string };
	},
	searchQueryOrLog?:
		| ((limit: number | undefined) => Promise<CommitsQueryResults>)
		| Promise<GitLog | undefined>
		| GitLog
		| undefined,
): (limit: number | undefined) => Promise<CommitsQueryResults> {
	if (typeof searchQueryOrLog === 'function') return searchQueryOrLog;

	// Create a search query function
	return async (limit: number | undefined) => {
		let log = searchQueryOrLog;
		if (log == null) {
			log = await view.container.git
				.getRepositoryService(repoPath)
				.commits.searchCommits(search, { source: 'view', detail: 'search&compare' })
				.then(r => r.log);
		} else if (log instanceof Promise) {
			log = await log;
		}

		if (log?.query != null) {
			log = await log.query(limit);
		}

		const count = log?.count ?? 0;
		const queryLabel = labels.queryLabel;
		const resultsType =
			typeof queryLabel === 'string'
				? { singular: 'search result', plural: 'search results' }
				: (queryLabel.resultsType ?? { singular: 'search result', plural: 'search results' });

		const label = `${pluralize(resultsType.singular, count, {
			format: c => (log?.hasMore ? `${c}+` : String(c)),
			plural: resultsType.plural,
			zero: 'No',
		})} ${typeof queryLabel === 'string' ? queryLabel : queryLabel.label}`;

		const results: Mutable<SearchQueryResults> = {
			label: label,
			log: log,
			hasMore: log?.hasMore ?? false,
		};

		if (results.hasMore) {
			results.more = async (limit: number | undefined) => {
				results.log = (await results.log?.more?.(limit)) ?? results.log;
				const newCount = results.log?.count ?? 0;
				results.label = `${pluralize(resultsType.singular, newCount, {
					format: c => (results.log?.hasMore ? `${c}+` : String(c)),
					plural: resultsType.plural,
					zero: 'No',
				})} ${typeof queryLabel === 'string' ? queryLabel : queryLabel.label}`;
				results.hasMore = results.log?.hasMore ?? true;
			};
		}

		return results;
	};
}
