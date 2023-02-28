import type { GitRevisionReference } from './models/reference';
import { isSha, shortenRevision } from './models/reference';
import type { GitUser } from './models/user';

export type SearchOperators =
	| ''
	| '=:'
	| 'message:'
	| '@:'
	| 'author:'
	| '#:'
	| 'commit:'
	| '?:'
	| 'file:'
	| '~:'
	| 'change:';

export const searchOperators = new Set<string>([
	'',
	'=:',
	'message:',
	'@:',
	'author:',
	'#:',
	'commit:',
	'?:',
	'file:',
	'~:',
	'change:',
]);

export interface SearchQuery {
	query: string;
	matchAll?: boolean;
	matchCase?: boolean;
	matchRegex?: boolean;
}

// Don't change this shape as it is persisted in storage
export interface StoredSearchQuery {
	pattern: string;
	matchAll?: boolean;
	matchCase?: boolean;
	matchRegex?: boolean;
}

export interface GitSearchResultData {
	date: number;
	i: number;
}
export type GitSearchResults = Map<string, GitSearchResultData>;

export interface GitSearch {
	repoPath: string;
	query: SearchQuery;
	comparisonKey: string;
	results: GitSearchResults;

	readonly paging?: {
		readonly limit: number | undefined;
		readonly hasMore: boolean;
	};

	more?(limit: number): Promise<GitSearch>;
}

export function getSearchQuery(search: StoredSearchQuery): SearchQuery {
	return {
		query: search.pattern,
		matchAll: search.matchAll,
		matchCase: search.matchCase,
		matchRegex: search.matchRegex,
	};
}

export function getStoredSearchQuery(search: SearchQuery): StoredSearchQuery {
	return {
		pattern: search.query,
		matchAll: search.matchAll,
		matchCase: search.matchCase,
		matchRegex: search.matchRegex,
	};
}

export function getSearchQueryComparisonKey(search: SearchQuery | StoredSearchQuery) {
	return `${'query' in search ? search.query : search.pattern}|${search.matchAll ? 'A' : ''}${
		search.matchCase ? 'C' : ''
	}${search.matchRegex ? 'R' : ''}`;
}

export function createSearchQueryForCommit(ref: string): string;
export function createSearchQueryForCommit(commit: GitRevisionReference): string;
export function createSearchQueryForCommit(refOrCommit: string | GitRevisionReference) {
	return `#:${typeof refOrCommit === 'string' ? shortenRevision(refOrCommit) : refOrCommit.name}`;
}

export function createSearchQueryForCommits(refs: string[]): string;
export function createSearchQueryForCommits(commits: GitRevisionReference[]): string;
export function createSearchQueryForCommits(refsOrCommits: (string | GitRevisionReference)[]) {
	return refsOrCommits.map(r => `#:${typeof r === 'string' ? shortenRevision(r) : r.name}`).join(' ');
}

const normalizeSearchOperatorsMap = new Map<SearchOperators, SearchOperators>([
	['', 'message:'],
	['=:', 'message:'],
	['message:', 'message:'],
	['@:', 'author:'],
	['author:', 'author:'],
	['#:', 'commit:'],
	['commit:', 'commit:'],
	['?:', 'file:'],
	['file:', 'file:'],
	['~:', 'change:'],
	['change:', 'change:'],
]);

const searchOperationRegex =
	/(?:(?<op>=:|message:|@:|author:|#:|commit:|\?:|file:|~:|change:)\s?(?<value>".+?"|\S+}?))|(?<text>\S+)(?!(?:=|message|@|author|#|commit|\?|file|~|change):)/gi;

export function parseSearchQuery(search: SearchQuery): Map<string, string[]> {
	const operations = new Map<string, string[]>();

	let op: SearchOperators | undefined;
	let value: string | undefined;
	let text: string | undefined;

	let match;
	do {
		match = searchOperationRegex.exec(search.query);
		if (match?.groups == null) break;

		op = normalizeSearchOperatorsMap.get(match.groups.op as SearchOperators);
		({ value, text } = match.groups);

		if (text) {
			op = text === '@me' ? 'author:' : isSha(text) ? 'commit:' : 'message:';
			value = text;
		}

		if (op && value) {
			const values = operations.get(op);
			if (values == null) {
				operations.set(op, [value]);
			} else {
				values.push(value);
			}
		}
	} while (match != null);

	return operations;
}

const doubleQuoteRegex = /"/g;

export function getGitArgsFromSearchQuery(
	search: SearchQuery,
	currentUser: GitUser | undefined,
): {
	args: string[];
	files: string[];
	shas?: Set<string> | undefined;
} {
	const operations = parseSearchQuery(search);

	const searchArgs = new Set<string>();
	const files: string[] = [];

	let shas;

	let op;
	let values = operations.get('commit:');
	if (values != null) {
		for (const value of values) {
			searchArgs.add(value.replace(doubleQuoteRegex, ''));
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
						value = value.replace(doubleQuoteRegex, search.matchRegex ? '\\b' : '');
						if (!value) continue;

						searchArgs.add(`--grep=${value}`);
					}

					break;

				case 'author:':
					for (let value of values) {
						if (!value) continue;
						value = value.replace(doubleQuoteRegex, search.matchRegex ? '\\b' : '');
						if (!value) continue;

						if (value === '@me') {
							if (currentUser?.name == null) continue;

							value = currentUser.name;
						}

						if (value.startsWith('@')) {
							searchArgs.add(`--author=${value.slice(1)}`);
							continue;
						}

						searchArgs.add(`--author=${value}`);
					}

					break;

				case 'change:':
					for (let value of values) {
						if (!value) continue;

						if (value.startsWith('"')) {
							value = value.replace(doubleQuoteRegex, '');
							if (!value) continue;
						}
						searchArgs.add(search.matchRegex ? `-G${value}` : `-S${value}`);
					}

					break;

				case 'file:':
					for (let value of values) {
						if (!value) continue;

						if (value.startsWith('"')) {
							value = value.replace(doubleQuoteRegex, '');
							if (!value) continue;

							files.push(value);
						} else {
							files.push(`${search.matchCase ? '' : ':(icase)'}${value}`);
						}
					}

					break;
			}
		}
	}

	return { args: [...searchArgs.values()], files: files, shas: shas };
}
