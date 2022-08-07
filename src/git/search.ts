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

export interface SearchPattern {
	pattern: string;
	matchAll?: boolean;
	matchCase?: boolean;
	matchRegex?: boolean;
}

export namespace SearchPattern {
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

	export function fromCommit(ref: string): string;
	export function fromCommit(commit: GitRevisionReference): string;
	export function fromCommit(refOrCommit: string | GitRevisionReference) {
		return `#:${typeof refOrCommit === 'string' ? GitRevision.shorten(refOrCommit) : refOrCommit.name}`;
	}

	export function fromCommits(refs: string[]): string;
	export function fromCommits(commits: GitRevisionReference[]): string;
	export function fromCommits(refsOrCommits: (string | GitRevisionReference)[]) {
		return refsOrCommits.map(r => `#:${typeof r === 'string' ? GitRevision.shorten(r) : r.name}`).join(' ');
	}

	export function parseSearchOperations(search: string): Map<string, string[]> {
		const operations = new Map<string, string[]>();

		let op: SearchOperators | undefined;
		let value: string | undefined;
		let text: string | undefined;

		let match;
		do {
			match = searchOperationRegex.exec(search);
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

	export function toKey(search: SearchPattern) {
		return `${search.pattern}|${search.matchAll ? 'A' : ''}${search.matchCase ? 'C' : ''}${
			search.matchRegex ? 'R' : ''
		}`;
	}
}
