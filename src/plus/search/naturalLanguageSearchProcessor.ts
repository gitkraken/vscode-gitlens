import type { CancellationToken } from 'vscode';
import { AIError } from '@gitlens/ai/errors.js';
import type { SearchQuery } from '@gitlens/git/models/search.js';
import { CancellationError, isCancellationError } from '@gitlens/utils/cancellation.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { Source } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';

export interface NaturalLanguageSearchOptions {
	context?: string;
}

export class NaturalLanguageSearchProcessor {
	constructor(private readonly container: Container) {}

	/** Converts natural language to a structured search query */
	async processNaturalLanguageToSearchQuery(
		searchQuery: SearchQuery,
		source: Source,
		options?: NaturalLanguageSearchOptions,
		cancellation?: CancellationToken,
	): Promise<SearchQuery> {
		if (!searchQuery.naturalLanguage) return searchQuery;

		const scope = getScopedLogger();

		searchQuery = { ...searchQuery, matchAll: false, matchCase: false, matchRegex: true };

		try {
			const result = await this.container.ai.actions.generateSearchQuery(
				{ query: searchQuery.query, context: options?.context },
				source,
				{ cancellation: cancellation },
			);
			if (result === 'cancelled') throw new CancellationError();

			if (!result?.result) {
				return {
					...searchQuery,
					naturalLanguage: { query: searchQuery.query, error: 'The AI returned an unusable response' },
				};
			}

			return {
				...searchQuery,
				query: result.result.query,
				filter: applySearchIntentMode(searchQuery.filter, result.result.mode),
				naturalLanguage: {
					query: searchQuery.query,
					processedQuery: result.result.query,
					explanation: result.result.explanation,
					mode: result.result.mode,
					alternates: result.result.alternates,
				},
			};
		} catch (ex) {
			if (isCancellationError(ex)) throw ex;

			scope?.error(ex, `Failed to convert to search query: "${searchQuery.query}"`);

			return {
				...searchQuery,
				// `AIError` messages are already user-appropriate; anything else gets stringified.
				naturalLanguage: { query: searchQuery.query, error: ex instanceof AIError ? ex.message : String(ex) },
			};
		}
	}
}

/** Routes the AI's search intent onto the query's `filter` flag — `'filter'` forces it on; every
 *  other mode (including absent) leaves the incoming toggle state untouched, so a 'highlight'
 *  result never turns an already-on filter toggle back off. */
export function applySearchIntentMode(
	filter: boolean | undefined,
	mode: 'highlight' | 'filter' | 'select' | undefined,
): boolean | undefined {
	return mode === 'filter' ? true : filter;
}
