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
			const result = await this.container.ai.generateSearchQuery(
				{ query: searchQuery.query, context: options?.context },
				source,
				{ cancellation: cancellation },
			);
			if (result === 'cancelled') throw new CancellationError();

			if (!result?.content) {
				return {
					...searchQuery,
					naturalLanguage: { query: searchQuery.query, error: 'Empty response returned' },
				};
			}

			const processedQuery = this.cleanResponse(result.content);

			return {
				...searchQuery,
				query: processedQuery,
				naturalLanguage: { query: searchQuery.query, processedQuery: processedQuery },
			};
		} catch (ex) {
			Logger.error(ex, scope, `Failed to convert to search query: "${searchQuery.query}"`);

			return {
				...searchQuery,
				naturalLanguage: { query: searchQuery.query, error: String(ex) },
			};
		}
	}

	private cleanResponse(response: string): string {
		// Remove any markdown formatting
		let cleaned = response.replace(/```[^`]*```/g, '').replace(/`([^`]+)`/g, '$1');

		// Remove common prefixes that AI might add
		cleaned = cleaned.replace(/^(search query:|query:|result:|converted query:)\s*/i, '');

		// Remove quotes if the entire response is quoted
		cleaned = cleaned.replace(/^"(.*)"$/, '$1');
		cleaned = cleaned.replace(/^'(.*)'$/, '$1');

		// Take only the first line if there are multiple lines
		cleaned = cleaned.split('\n')[0];

		return cleaned.trim();
	}
}
