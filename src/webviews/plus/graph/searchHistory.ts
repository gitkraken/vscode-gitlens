import type { SearchQuery } from '../../../constants.search';
import type { Container } from '../../../container';

/** Maximum number of search history entries to store */
export const maximumSearchHistory = 50;

/** Loads search history from workspace storage */
export function loadSearchHistory(container: Container): SearchQuery[] {
	const history = container.storage.getWorkspace('graph:searchHistory') ?? [];
	return history.map(s => ({
		query: s.query,
		matchAll: s.matchAll,
		matchCase: s.matchCase,
		matchRegex: s.matchRegex,
	}));
}

/** Stores a search query to history in workspace storage */
export async function storeSearchHistory(container: Container, searchQuery: SearchQuery): Promise<void> {
	// Don't store empty queries
	if (!searchQuery.query?.trim()) return;

	const history = container.storage.getWorkspace('graph:searchHistory') ?? [];

	// Filter out duplicates and add new query first
	const newHistory = history.filter(s => s.query !== searchQuery.query);
	newHistory.unshift({
		query: searchQuery.query,
		matchAll: searchQuery.matchAll,
		matchCase: searchQuery.matchCase,
		matchRegex: searchQuery.matchRegex,
	});

	// Save back to storage
	await container.storage.storeWorkspace('graph:searchHistory', newHistory.slice(0, maximumSearchHistory));
}
