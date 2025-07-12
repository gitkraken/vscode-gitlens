import type { SearchOperators, SearchOperatorsLongForm, SearchQuery } from '../constants.search';
import { searchOperators, searchOperatorsToLongFormMap } from '../constants.search';
import type { StoredSearchQuery } from '../constants.storage';
import type { Source } from '../constants.telemetry';
import type { Container } from '../container';
import type { NaturalLanguageSearchOptions } from '../plus/search/naturalLanguageSearchProcessor';
import { NaturalLanguageSearchProcessor } from '../plus/search/naturalLanguageSearchProcessor';
import type { GitRevisionReference } from './models/reference';
import type { GitUser } from './models/user';
import { isSha, shortenRevision } from './utils/revision.utils';

export interface GitGraphSearchResultData {
	date: number;
	i: number;
}
export type GitGraphSearchResults = Map<string, GitGraphSearchResultData>;

export interface GitGraphSearch {
	repoPath: string;
	query: SearchQuery;
	comparisonKey: string;
	results: GitGraphSearchResults;

	readonly paging?: {
		readonly limit: number | undefined;
		readonly hasMore: boolean;
	};

	more?(limit: number): Promise<GitGraphSearch>;
}

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
	return `${'query' in search ? search.query : search.pattern}|${search.matchAll ? 'A' : ''}${
		search.matchCase ? 'C' : ''
	}${search.matchRegex ? 'R' : ''}${search.matchWholeWord ? 'W' : ''}${search.naturalLanguage ? 'NL' : ''}`;
}

export function createSearchQueryForCommit(ref: string): string;
export function createSearchQueryForCommit(commit: GitRevisionReference): string;
export function createSearchQueryForCommit(refOrCommit: string | GitRevisionReference): string {
	return `#:${typeof refOrCommit === 'string' ? shortenRevision(refOrCommit) : refOrCommit.name}`;
}

export function createSearchQueryForCommits(refs: string[]): string;
export function createSearchQueryForCommits(commits: GitRevisionReference[]): string;
export function createSearchQueryForCommits(refsOrCommits: (string | GitRevisionReference)[]): string {
	return refsOrCommits.map(r => `#:${typeof r === 'string' ? shortenRevision(r) : r.name}`).join(' ');
}

export function parseSearchQuery(search: SearchQuery): Map<SearchOperatorsLongForm, Set<string>> {
	const operations = new Map<SearchOperatorsLongForm, Set<string>>();
	const query = search.query.trim();

	let pos = 0;

	while (pos < query.length) {
		// Skip whitespace
		if (/\s/.test(query[pos])) {
			pos++;
			continue;
		}

		// Try to match an operator
		let matchedOperator = false;
		let op: SearchOperators | undefined;
		let value: string | undefined;

		// Check for operators (starting with longer ones first to avoid partial matches)
		for (const operator of searchOperators) {
			if (!operator.length) continue;

			if (query.startsWith(operator, pos)) {
				op = operator as SearchOperators;
				const startPos = pos + operator.length;
				pos = startPos;

				// Skip optional space after operator
				if (query[pos] === ' ') {
					pos++;
				}

				// Extract the value and check if it is quoted
				if (query[pos] === '"') {
					const endQuotePos = query.indexOf('"', pos + 1);
					if (endQuotePos !== -1) {
						value = query.substring(pos, endQuotePos + 1);
						pos = endQuotePos + 1;
					} else {
						// Unterminated quote, take the rest of the string
						value = query.substring(pos);
						pos = query.length;
					}
				} else {
					// Unquoted value - take until whitespace
					const nextSpacePos = query.indexOf(' ', pos);
					const valueEndPos = nextSpacePos !== -1 ? nextSpacePos : query.length;
					value = query.substring(pos, valueEndPos);
					pos = valueEndPos;
				}

				matchedOperator = true;
				break;
			}
		}

		if (!matchedOperator) {
			// No operator found, parse as text
			let text: string;

			// Check if text is quoted
			if (query[pos] === '"') {
				const endQuotePos = query.indexOf('"', pos + 1);
				if (endQuotePos !== -1) {
					text = query.substring(pos, endQuotePos + 1);
					pos = endQuotePos + 1;
				} else {
					// Unterminated quote, take the rest of the string
					text = query.substring(pos);
					pos = query.length;
				}
			} else {
				// Unquoted text - take until whitespace
				const nextSpacePos = query.indexOf(' ', pos);
				const valueEndPos = nextSpacePos !== -1 ? nextSpacePos : query.length;
				text = query.substring(pos, valueEndPos);
				pos = valueEndPos;
			}

			// Handle special text tokens (@me, SHA)
			op = text === '@me' ? 'author:' : isSha(text) ? 'commit:' : 'message:';
			value = text;
		}

		// Add the discovered operation to our map
		if (op && value) {
			const longFormOp = searchOperatorsToLongFormMap.get(op);
			if (longFormOp) {
				let values = operations.get(longFormOp);
				if (values == null) {
					values = new Set();
					operations.set(longFormOp, values);
				}
				values.add(value);
			}
		}
	}

	return operations;
}

export interface SearchQueryFilters {
	/** Specifies whether the search results will be filtered to specific files */
	files: boolean;
	/** Specifies whether the search results will be filtered to a specific type, only `stash` is supported */
	type?: 'stash';
}

export interface SearchQueryCommand {
	/** Git log args */
	args: string[];
	/** Pathspecs to search, if any */
	files: string[];
	/** SHAs to search, if any */
	shas?: Set<string> | undefined;

	filters: SearchQueryFilters;
}

export function parseSearchQueryCommand(search: SearchQuery, currentUser: GitUser | undefined): SearchQueryCommand {
	const operations = parseSearchQuery(search);

	const searchArgs = new Set<string>();
	const files: string[] = [];
	let shas;
	const filters: SearchQueryFilters = {
		files: false,
		type: undefined,
	};

	let op;
	let values = operations.get('commit:');
	if (values != null) {
		for (let value of values) {
			if (!value) continue;

			if (value.startsWith('"') && value.endsWith('"')) {
				value = value.slice(1, -1);
				if (!value) continue;
			}

			searchArgs.add(value);
		}
		shas = searchArgs;
	} else {
		searchArgs.add('--all');
		searchArgs.add(search.matchRegex ? '--extended-regexp' : '--fixed-strings');
		if (search.matchRegex && !search.matchCase) {
			searchArgs.add('--regexp-ignore-case');
		}

		for ([op, values] of operations.entries()) {
			switch (op) {
				case 'message:':
					if (search.matchAll) {
						searchArgs.add('--all-match');
					}
					for (let value of values) {
						if (!value) continue;

						if (value.startsWith('"') && value.endsWith('"')) {
							value = value.slice(1, -1);
							if (!value) continue;
						}

						if (search.matchWholeWord && search.matchRegex) {
							value = `\\b${value}\\b`;
						}

						searchArgs.add(`--grep=${value}`);
					}

					break;

				case 'author:':
					for (let value of values) {
						if (!value) continue;

						if (value.startsWith('"') && value.endsWith('"')) {
							value = value.slice(1, -1);
							if (!value) continue;
						}

						if (value === '@me') {
							if (!currentUser?.name) continue;

							value = currentUser.name;
						}

						if (value.startsWith('@')) {
							value = value.slice(1);
						}

						if (search.matchWholeWord && search.matchRegex) {
							value = `\\b${value}\\b`;
						}

						searchArgs.add(`--author=${value}`);
					}

					break;

				case 'type:':
					for (let value of values) {
						if (!value) continue;

						if (value.startsWith('"') && value.endsWith('"')) {
							value = value.slice(1, -1);
							if (!value) continue;
						}

						if (value === 'stash') {
							filters.type = 'stash';
							searchArgs.add('--no-walk');
						}
					}

					break;

				case 'file:':
					for (let value of values) {
						if (!value) continue;

						if (value.startsWith('"') && value.endsWith('"')) {
							value = value.slice(1, -1);
							if (!value) continue;

							filters.files = true;
							files.push(value);
						} else {
							filters.files = true;

							const prefix = search.matchCase ? '' : ':(icase)';
							if (value.includes('**')) {
								files.push(`${prefix}:(glob)${value}`);
							} else if (/[./\\*?|![\]{}]/.test(value)) {
								files.push(`${prefix}${value}`);
							} else {
								files.push(`${prefix}*${value}*`);
							}
						}
					}

					break;

				case 'change:':
					for (let value of values) {
						if (!value) continue;

						if (value.startsWith('"') && value.endsWith('"')) {
							value = value.slice(1, -1);
							if (!value) continue;
						}

						filters.files = true;
						searchArgs.add(search.matchRegex ? `-G${value}` : `-S${value}`);
					}

					break;

				case 'after:':
				case 'before:': {
					const flag = op === 'after:' ? '--since' : '--until';
					for (let value of values) {
						if (!value) continue;

						if (value.startsWith('"') && value.endsWith('"')) {
							value = value.slice(1, -1);
							if (!value) continue;
						}

						searchArgs.add(`${flag}=${value}`);
					}

					break;
				}
			}
		}
	}

	return {
		args: [...searchArgs.values()],
		files: files,
		shas: shas,
		filters: filters,
	};
}

/** Converts natural language to a structured search query */
export async function processNaturalLanguageToSearchQuery(
	container: Container,
	search: SearchQuery,
	source: Source,
	options?: NaturalLanguageSearchOptions,
): Promise<SearchQuery> {
	return new NaturalLanguageSearchProcessor(container).processNaturalLanguageToSearchQuery(search, source, options);
}
