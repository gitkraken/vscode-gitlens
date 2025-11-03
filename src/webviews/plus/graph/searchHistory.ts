import type { SearchQuery } from '../../../constants.search';
import type { Storage } from '../../../system/-webview/storage';

/** Maximum number of search history entries to store */
const maximumSearchHistory = 50;

export class SearchHistory {
	constructor(
		private readonly storage: Storage,
		private readonly repoPath: string | undefined,
	) {}

	/** Deletes a search query from history in workspace storage */
	async delete(query: string): Promise<void> {
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
	async store(searchQuery: SearchQuery): Promise<void> {
		// Don't store empty queries or if no repo
		if (!searchQuery.query?.trim() || !this.repoPath) return;

		const key = `graph:searchHistory:${this.repoPath}` as const;
		const history = this.storage.getWorkspace(key) ?? [];

		// For NL queries: use the original input for dedup, but also store the structured form
		// For normal queries: just use the query as-is
		const dedupeKey = searchQuery.naturalLanguage ? searchQuery.query : normalizeSearchQuery(searchQuery.query);
		const normalizedDedup = normalizeSearchQuery(dedupeKey);

		// Find existing entry by dedup key
		const existingIndex = history.findIndex(h => {
			const hDedupeKey = h.naturalLanguage ? h.query : h.query;
			return normalizeSearchQuery(hDedupeKey) === normalizedDedup;
		});

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

function normalizeSearchQuery(query: string, getCanonical: boolean = false): string {
	// Trim, collapse internal whitespace
	let q = query.trim().replace(/\s+/g, ' ');

	// Prevent duplicate @me plus author:@ patterns: if both present, remove raw @me token
	const hasAuthorAtMe = /\bauthor:\s*@?me\b/i.test(q);
	if (hasAuthorAtMe) {
		q = q
			.replace(/(^|\s)@me(\s|$)/gi, ' ')
			.replace(/\s+/g, ' ')
			.trim();
	}

	// For canonical form (lowercased), return now
	if (getCanonical) return q.toLowerCase();

	// For comparison, lowercase only
	return q.toLowerCase();
}
