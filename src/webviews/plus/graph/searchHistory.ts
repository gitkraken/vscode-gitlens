import type { SearchQuery } from '@gitlens/git/models/search.js';
import type { Storage } from '../../../system/-webview/storage.js';

/** Maximum number of search history entries to store */
const maximumSearchHistory = 50;

export class SearchHistory {
	constructor(
		private readonly storage: Storage,
		private readonly repoPath: string | undefined,
	) {}

	// Serializes read-modify-write operations on workspace storage. Without this, two concurrent
	// `store()` (or `delete()`) calls both read the same pre-state, both compute their own next-state,
	// and the second `storeWorkspace` clobbers the first.
	//
	// The chain (`_writes`) and the per-call returned promise are deliberately different shapes: the
	// chain swallows rejections with `.catch` so a single failed write doesn't poison every future
	// write; the returned promise preserves the rejection so the caller (IPC handler) can surface
	// the error.
	private _writes: Promise<unknown> = Promise.resolve();

	/** Deletes a search query from history in workspace storage */
	delete(query: string): Promise<void> {
		const work = this._writes.then(() => this.doDelete(query));
		this._writes = work.catch(() => undefined);
		return work;
	}

	private async doDelete(query: string): Promise<void> {
		if (!query?.trim() || !this.repoPath) return;

		const key = `graph:searchHistory:${this.repoPath}` as const;
		const history = this.storage.getWorkspace(key) ?? [];

		// Remove the entry matching the query
		const filtered = history.filter(h => h.query !== query);

		if (filtered.length < history.length) {
			await this.storage.storeWorkspace(key, filtered);
		}
	}

	/** Loads search history from workspace storage */
	get(): SearchQuery[] {
		if (!this.repoPath) return [];

		const key = `graph:searchHistory:${this.repoPath}` as const;
		const history = this.storage.getWorkspace(key) ?? [];
		return history.map(s => ({
			query: s.query, // Show what user entered (NL or structured)
			matchAll: s.matchAll,
			matchCase: s.matchCase,
			matchRegex: s.matchRegex,
			matchWholeWord: s.matchWholeWord,
			// Reconstruct NL mode object with original input and cached structured form
			naturalLanguage: s.naturalLanguage
				? {
						query: s.query, // Original NL input user typed
						processedQuery: s.nlStructuredQuery, // Last known structured version (may be re-processed)
					}
				: undefined,
		}));
	}

	/** Stores a search query to history in workspace storage */
	store(searchQuery: SearchQuery): Promise<void> {
		const work = this._writes.then(() => this.doStore(searchQuery));
		this._writes = work.catch(() => undefined);
		return work;
	}

	private async doStore(searchQuery: SearchQuery): Promise<void> {
		// Don't store empty queries or if no repo
		if (!searchQuery.query?.trim() || !this.repoPath) return;

		const key = `graph:searchHistory:${this.repoPath}` as const;
		const history = this.storage.getWorkspace(key) ?? [];

		const normalizedDedup = normalizeSearchQuery(searchQuery.query);
		const existingIndex = history.findIndex(h => normalizeSearchQuery(h.query) === normalizedDedup);

		if (existingIndex >= 0) {
			// Promote existing entry to front
			history.splice(existingIndex, 1);
		}

		const newHistory = [
			{
				query: searchQuery.query,
				matchAll: searchQuery.matchAll,
				matchCase: searchQuery.matchCase,
				matchRegex: searchQuery.matchRegex,
				matchWholeWord: searchQuery.matchWholeWord,
				naturalLanguage: searchQuery.naturalLanguage ? true : undefined,
				// For NL queries, also store the structured form they generated
				nlStructuredQuery:
					searchQuery.naturalLanguage && typeof searchQuery.naturalLanguage !== 'boolean'
						? searchQuery.naturalLanguage.processedQuery
						: undefined,
			},
			...history,
		];

		// Save back to storage (limit)
		await this.storage.storeWorkspace(key, newHistory.slice(0, maximumSearchHistory));
	}
}

function normalizeSearchQuery(query: string): string {
	let q = query.trim().replace(/\s+/g, ' ');

	// Prevent duplicate @me plus author:@ patterns: if both present, remove raw @me token
	if (/\bauthor:\s*@?me\b/i.test(q)) {
		q = q
			.replace(/(^|\s)@me(\s|$)/gi, ' ')
			.replace(/\s+/g, ' ')
			.trim();
	}

	return q.toLowerCase();
}
