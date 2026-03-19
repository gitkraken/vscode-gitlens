import type { SearchQuery } from '@gitlens/git/models/search.js';
import { getSearchQueryComparisonKey as getSearchQueryComparisonKeyCore } from '@gitlens/git/utils/search.utils.js';
import type { StoredSearchQuery } from '../../../constants.storage.js';

export function getSearchQuery(search: StoredSearchQuery): SearchQuery {
	return {
		query: search.pattern,
		matchAll: search.matchAll,
		matchCase: search.matchCase,
		matchRegex: search.matchRegex,
		matchWholeWord: search.matchWholeWord,
		naturalLanguage:
			typeof search.naturalLanguage === 'object'
				? { ...search.naturalLanguage }
				: typeof search.naturalLanguage === 'boolean'
					? search.naturalLanguage
					: undefined,
	};
}

export function getStoredSearchQuery(search: SearchQuery): StoredSearchQuery {
	return {
		pattern: search.query,
		matchAll: search.matchAll,
		matchCase: search.matchCase,
		matchRegex: search.matchRegex,
		matchWholeWord: search.matchWholeWord,
		naturalLanguage:
			typeof search.naturalLanguage === 'object'
				? { query: search.naturalLanguage.query, processedQuery: search.naturalLanguage.processedQuery }
				: typeof search.naturalLanguage === 'boolean'
					? search.naturalLanguage
					: undefined,
	};
}

export function getSearchQueryComparisonKey(search: SearchQuery | StoredSearchQuery): string {
	if ('query' in search) return getSearchQueryComparisonKeyCore(search);

	return `${search.pattern}|${search.matchAll ? 'A' : ''}${search.matchCase ? 'C' : ''}${
		search.matchRegex ? 'R' : ''
	}${search.matchWholeWord ? 'W' : ''}${search.naturalLanguage ? 'NL' : ''}`;
}
