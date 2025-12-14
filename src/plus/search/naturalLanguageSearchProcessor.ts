import type { CancellationToken } from 'vscode';
import type { SearchQuery } from '../../constants.search';
import type { Source } from '../../constants.telemetry';
import type { Container } from '../../container';
import { CancellationError } from '../../errors';
import { Logger } from '../../system/logger';
import { getLogScope } from '../../system/logger.scope';

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

		const scope = getLogScope();

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
					naturalLanguage: { query: searchQuery.query, error: 'Empty response returned' },
				};
			}

			return {
				...searchQuery,
				query: result.result,
				naturalLanguage: { query: searchQuery.query, processedQuery: result.result },
			};
		} catch (ex) {
			Logger.error(ex, scope, `Failed to convert to search query: "${searchQuery.query}"`);

			return {
				...searchQuery,
				naturalLanguage: { query: searchQuery.query, error: String(ex) },
			};
		}
	}
}
