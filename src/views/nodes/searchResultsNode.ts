import type { TreeItem } from 'vscode';
import { l10n, ThemeIcon } from 'vscode';
import type { GitLog } from '@gitlens/git/models/log.js';
import type { SearchQuery } from '@gitlens/git/models/search.js';
import { md5 } from '@gitlens/utils/crypto.js';
import { executeGitCommand } from '../../git/actions.js';
import type { CommitsQueryResults } from '../../git/queryResults.js';
import { getSearchQueryComparisonKey, getStoredSearchQuery } from '../../git/utils/-webview/search.utils.js';
import type { SearchAndCompareView } from '../searchAndCompareView.js';
import type { ViewNode } from './abstract/viewNode.js';
import { ContextValues, getViewNodeId } from './abstract/viewNode.js';
import { ResultsCommitsNodeBase } from './resultsCommitsNode.js';

interface SearchQueryResults {
	readonly label: string;
	readonly log: GitLog | undefined;
	readonly hasMore: boolean;
	more?(limit: number | undefined): Promise<void>;
}

export class SearchResultsNode extends ResultsCommitsNodeBase<'search-results', SearchAndCompareView> {
	private _search: SearchQuery;
	private _storedAt: number;

	constructor(
		view: SearchAndCompareView,
		parent: ViewNode,
		repoPath: string,
		search: SearchQuery,
		searchQueryOrLog?:
			| ((limit: number | undefined) => Promise<CommitsQueryResults>)
			| Promise<GitLog | undefined>
			| GitLog
			| undefined,
		storedAt: number = 0,
	) {
		const query = createSearchQuery(view, repoPath, search, searchQueryOrLog);
		const deferred = searchQueryOrLog == null;

		super(
			'search-results',
			view,
			parent,
			repoPath,
			l10n.t('Search results for {0}', search.query),
			{ query: query, deferred: deferred },
			{ expand: false },
		);

		this._search = search;
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
		if (this._results.deferred) {
			item.label = l10n.t('Search results for {0}', this.search.query);
		}
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
		this._results.query = createSearchQuery(this.view, this.repoPath, this._search);
		this._results.deferred = true;

		// Remove the existing stored item and save a new one
		await this.replace(currentId, true);

		void this.triggerChange(true);
		void this.view.reveal(this, { expand: true, focus: true, select: true });
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
				.commits.searchCommits(search, { source: { source: 'view', detail: 'search&compare' } })
				.then(r => r.log);
		} else if (log instanceof Promise) {
			log = await log;
		}

		if (log?.query != null) {
			log = await log.query(limit);
		}

		const count = log?.count ?? 0;
		const label = getSearchResultsLabel(count, log?.hasMore ?? false, search.query);

		const results: Mutable<SearchQueryResults> = {
			label: label,
			log: log,
			hasMore: log?.hasMore ?? false,
		};

		if (results.hasMore) {
			results.more = async (limit: number | undefined) => {
				results.log = (await results.log?.more?.(limit)) ?? results.log;
				const newCount = results.log?.count ?? 0;
				results.label = getSearchResultsLabel(newCount, results.log?.hasMore ?? false, search.query);
				results.hasMore = results.log?.hasMore ?? true;
			};
		}

		return results;
	};
}

function getSearchResultsLabel(count: number, hasMore: boolean, query: string): string {
	if (count === 0) return l10n.t('No search results for {0}', query);

	const formattedCount = hasMore ? `${count}+` : String(count);
	return count === 1
		? l10n.t('{0} search result for {1}', formattedCount, query)
		: l10n.t('{0} search results for {1}', formattedCount, query);
}
