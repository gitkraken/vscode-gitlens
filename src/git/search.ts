import type { GitRevisionReference } from './models/reference';
import { GitRevision } from './models/reference';

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

export interface GitSearch {
	repoPath: string;
	query: SearchQuery;
	comparisonKey: string;
	results: Set<string>;

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
	return `#:${typeof refOrCommit === 'string' ? GitRevision.shorten(refOrCommit) : refOrCommit.name}`;
}

export function createSearchQueryForCommits(refs: string[]): string;
export function createSearchQueryForCommits(commits: GitRevisionReference[]): string;
export function createSearchQueryForCommits(refsOrCommits: (string | GitRevisionReference)[]) {
	return refsOrCommits.map(r => `#:${typeof r === 'string' ? GitRevision.shorten(r) : r.name}`).join(' ');
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
	/(?:(?<op>=:|message:|@:|author:|#:|commit:|\?:|file:|~:|change:)\s?(?<value>".+?"|\S+\b}?))|(?<text>\S+)(?!(?:=|message|@|author|#|commit|\?|file|~|change):)/gi;

export function parseSearchQuery(query: string): Map<string, string[]> {
	const operations = new Map<string, string[]>();

	let op: SearchOperators | undefined;
	let value: string | undefined;
	let text: string | undefined;

	let match;
	do {
		match = searchOperationRegex.exec(query);
		if (match?.groups == null) break;

		op = normalizeSearchOperatorsMap.get(match.groups.op as SearchOperators);
		({ value, text } = match.groups);

		if (text) {
			op = GitRevision.isSha(text) ? 'commit:' : 'message:';
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

export function getGitArgsFromSearchQuery(search: SearchQuery): {
	args: string[];
	files: string[];
	shas?: Set<string> | undefined;
} {
	const operations = parseSearchQuery(search.query);

	const searchArgs = new Set<string>();
	const files: string[] = [];

	let shas;

	let op;
	let values = operations.get('commit:');
	if (values != null) {
		// searchArgs.add('-m');
		for (const value of values) {
			searchArgs.add(value.replace(doubleQuoteRegex, ''));
		}
		shas = searchArgs;
	} else {
		searchArgs.add('--all');
		searchArgs.add('--full-history');
		searchArgs.add(search.matchRegex ? '--extended-regexp' : '--fixed-strings');
		if (search.matchRegex && !search.matchCase) {
			searchArgs.add('--regexp-ignore-case');
		}

		for ([op, values] of operations.entries()) {
			switch (op) {
				case 'message:':
					searchArgs.add('-m');
					if (search.matchAll) {
						searchArgs.add('--all-match');
					}
					for (const value of values) {
						searchArgs.add(`--grep=${value.replace(doubleQuoteRegex, search.matchRegex ? '\\b' : '')}`);
					}

					break;

				case 'author:':
					searchArgs.add('-m');
					for (const value of values) {
						searchArgs.add(`--author=${value.replace(doubleQuoteRegex, search.matchRegex ? '\\b' : '')}`);
					}

					break;

				case 'change:':
					for (const value of values) {
						searchArgs.add(
							search.matchRegex
								? `-G${value.replace(doubleQuoteRegex, '')}`
								: `-S${value.replace(doubleQuoteRegex, '')}`,
						);
					}

					break;

				case 'file:':
					for (const value of values) {
						files.push(value.replace(doubleQuoteRegex, ''));
					}

					break;
			}
		}
	}

	return { args: [...searchArgs.values()], files: files, shas: shas };
}
