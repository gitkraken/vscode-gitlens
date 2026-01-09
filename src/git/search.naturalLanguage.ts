import type { SearchQuery } from '../constants.search.js';
import type { Source } from '../constants.telemetry.js';
import type { Container } from '../container.js';
import type { NaturalLanguageSearchOptions } from '../plus/search/naturalLanguageSearchProcessor.js';
import { NaturalLanguageSearchProcessor } from '../plus/search/naturalLanguageSearchProcessor.js';

/** Converts natural language to a structured search query */
export async function processNaturalLanguageToSearchQuery(
	container: Container,
	search: SearchQuery,
	source: Source,
	options?: NaturalLanguageSearchOptions,
): Promise<SearchQuery> {
	return new NaturalLanguageSearchProcessor(container).processNaturalLanguageToSearchQuery(search, source, options);
}
