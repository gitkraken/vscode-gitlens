import type { SearchQuery } from '../constants.search';
import type { Source } from '../constants.telemetry';
import type { Container } from '../container';
import type { NaturalLanguageSearchOptions } from '../plus/search/naturalLanguageSearchProcessor';
import { NaturalLanguageSearchProcessor } from '../plus/search/naturalLanguageSearchProcessor';

/** Converts natural language to a structured search query */
export async function processNaturalLanguageToSearchQuery(
	container: Container,
	search: SearchQuery,
	source: Source,
	options?: NaturalLanguageSearchOptions,
): Promise<SearchQuery> {
	return new NaturalLanguageSearchProcessor(container).processNaturalLanguageToSearchQuery(search, source, options);
}
