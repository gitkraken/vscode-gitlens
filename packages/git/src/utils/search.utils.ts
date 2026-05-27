import { some } from '@gitlens/utils/iterable.js';
import type { GitRevisionReference } from '../models/reference.js';
import type {
	GitCommitSearchContext,
	HighlightableOperator,
	ParsedSearchQuery,
	SearchOperators,
	SearchOperatorsLongForm,
	SearchQuery,
	SearchQueryFilters,
	SearchQueryGitCommand,
	SearchQueryGitHubCommand,
} from '../models/search.js';
import { searchOperators, searchOperatorsToLongFormMap } from '../models/search.js';
import type { GitUser } from '../models/user.js';
import { isSha, shortenRevision } from './revision.utils.js';

export function getSearchQueryComparisonKey(search: SearchQuery): string {
	return `${search.query}|${search.matchAll ? 'A' : ''}${search.matchCase ? 'C' : ''}${
		search.matchRegex ? 'R' : ''
	}${search.matchWholeWord ? 'W' : ''}${search.naturalLanguage ? 'NL' : ''}`;
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

export function rebuildSearchQueryFromParsed(parsed: ParsedSearchQuery): string {
	const parts: string[] = [];

	for (const [operator, values] of parsed.operations) {
		for (const value of values) {
			parts.push(`${operator}${value}`);
		}
	}

	return parts.join(' ');
}

export function parseSearchQuery(search: SearchQuery, validate: boolean = false): ParsedSearchQuery {
	const operations = new Map<SearchOperatorsLongForm, Set<string>>();
	const query = search.query.trim();

	let errors: string[] | undefined;
	let operatorRanges: Array<{ start: number; end: number; operator: HighlightableOperator }> | undefined;
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
				const operatorStart = pos;
				const startPos = pos + operator.length;
				pos = startPos;

				// Track operator position
				operatorRanges ??= [];
				operatorRanges.push({
					start: operatorStart,
					end: startPos,
					operator: op,
				});

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
			const textStart = pos;
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
			if (text === '@me') {
				op = 'author:';
				// Track @me position for highlighting
				operatorRanges ??= [];
				operatorRanges.push({
					start: textStart,
					end: textStart + text.length,
					operator: '@me',
				});
			} else {
				op = isSha(text) ? 'commit:' : 'message:';
			}
			value = text;
		}

		// Validate operator has a value
		if (op && !value) {
			if (!validate) continue;

			errors ??= [];
			errors.push(`'${op}' requires a value`);
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

	return {
		operations: operations,
		...(errors?.length && { errors: errors }),
		...(operatorRanges?.length && { operatorRanges: operatorRanges }),
	};
}

export function parseSearchQueryGitCommand(
	search: SearchQuery,
	currentUser: GitUser | undefined,
): SearchQueryGitCommand {
	const { operations } = parseSearchQuery(search);

	const searchArgs = new Set<string>();
	const files: string[] = [];
	let shas;
	const filters: SearchQueryFilters = { files: false, type: undefined, refs: false };

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
						} else if (value === 'tip') {
							filters.type = 'tip';
						} else if (value === 'wip') {
							filters.type = 'wip';
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

				case 'ref:':
					for (let value of values) {
						if (!value) continue;

						if (value.startsWith('"') && value.endsWith('"')) {
							value = value.slice(1, -1);
							if (!value) continue;
						}

						filters.refs = true;
						// Replace --all with the specific ref or ref range
						searchArgs.delete('--all');
						searchArgs.add(value);
					}

					break;
			}
		}

		// Add regex/string matching flags if we have (--grep, --author) patterns
		if (some(searchArgs.values(), arg => arg.startsWith('--grep=') || arg.startsWith('--author='))) {
			searchArgs.add(search.matchRegex ? '--extended-regexp' : '--fixed-strings');
			if (search.matchRegex && !search.matchCase) {
				searchArgs.add('--regexp-ignore-case');
			}
		}
	}

	return {
		args: [...searchArgs.values()],
		files: files,
		shas: shas,
		filters: filters,
		operations: operations,
	};
}

export function parseSearchQueryGitHubCommand(
	search: SearchQuery,
	currentUser: GitUser | undefined,
): SearchQueryGitHubCommand {
	const { operations } = parseSearchQuery(search);

	const queryArgs = [];
	const filters: SearchQueryFilters = { files: false, type: undefined, refs: false };

	for (const [op, values] of operations.entries()) {
		switch (op) {
			case 'message:':
				for (let value of values) {
					if (!value) continue;

					if (value.startsWith('"') && value.endsWith('"')) {
						value = value.slice(1, -1);
						if (!value) continue;
					}

					if (search.matchWholeWord && search.matchRegex) {
						value = `\\b${value}\\b`;
					}

					queryArgs.push(value.replace(/ /g, '+'));
				}
				break;

			case 'author:': {
				for (let value of values) {
					if (!value) continue;

					if (value.startsWith('"') && value.endsWith('"')) {
						value = value.slice(1, -1);
						if (!value) continue;
					}

					if (value === '@me') {
						if (!currentUser?.name) continue;

						value = `@${currentUser.username}`;
					}

					value = value.replace(/ /g, '+');
					if (value.startsWith('@')) {
						value = value.slice(1);
						queryArgs.push(`author:${value.slice(1)}`);
					} else if (value.includes('@')) {
						queryArgs.push(`author-email:${value}`);
					} else {
						queryArgs.push(`author-name:${value}`);
					}
				}

				break;
			}

			case 'type:':
			case 'file:':
			case 'change:':
			case 'ref:':
				// Not supported in GitHub search
				break;

			case 'after:':
			case 'before:': {
				const flag = op === 'after:' ? 'author-date:>' : 'author-date:<';

				for (let value of values) {
					if (!value) continue;

					if (value.startsWith('"') && value.endsWith('"')) {
						value = value.slice(1, -1);
						if (!value) continue;
					}

					// if value is YYYY-MM-DD then include it, otherwise we can't use it
					if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
						queryArgs.push(`${flag}${value}`);
					}
				}
				break;
			}
		}
	}

	return { args: queryArgs, filters: filters, operations: operations };
}

export function areSearchContextsEqual(
	a: GitCommitSearchContext | undefined,
	b: GitCommitSearchContext | undefined,
	deep: boolean,
): boolean {
	if (a === b) return true;
	if (a == null || b == null) return false;

	return (
		a.query === b.query &&
		(!deep ||
			(a.queryFilters.files === b.queryFilters.files &&
				a.queryFilters.refs === b.queryFilters.refs &&
				a.queryFilters.type === b.queryFilters.type &&
				a.matchedFiles.length === b.matchedFiles.length &&
				a.matchedFiles.every((f, i) => f.path === b.matchedFiles[i].path)))
	);
}

export function areSearchQueriesEqual(a: SearchQuery | undefined, b: SearchQuery | undefined): boolean {
	if (a === b) return true;
	if (a == null || b == null) return false;

	return (
		a.query === b.query &&
		a.filter === b.filter &&
		a.matchAll === b.matchAll &&
		a.matchCase === b.matchCase &&
		a.matchRegex === b.matchRegex &&
		a.matchWholeWord === b.matchWholeWord &&
		Boolean(a.naturalLanguage) === Boolean(b.naturalLanguage)
	);
}
