'use strict';
import { GitRevision } from './git';
import { GitRevisionReference } from './models/models';

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
	const emptyStr = '';

	const searchMessageOperationRegex = /(?=(.*?)\s?(?:(?:=:|message:|@:|author:|#:|commit:|\?:|file:|~:|change:)|$))/;
	const searchMessageValuesRegex = /(".+"|[^\b\s]+)/g;
	const searchOperationRegex = /((?:=|message|@|author|#|commit|\?|file|~|change):)\s?(?=(.*?)\s?(?:(?:=:|message:|@:|author:|#:|commit:|\?:|file:|~:|change:)|$))/g;

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

		let op;
		let value;

		let match = searchMessageOperationRegex.exec(search);
		if (match != null && match[1] !== '') {
			[, value] = match;

			if (GitRevision.isSha(value)) {
				let values = operations.get('commit:');
				if (values === undefined) {
					values = [value];
					operations.set('commit:', values);
				} else {
					values.push(value);
				}
			} else {
				parseSearchMessageOperations(value, operations);
			}
		}

		do {
			match = searchOperationRegex.exec(search);
			if (match == null) break;

			[, op, value] = match;

			if (op !== undefined) {
				op = normalizeSearchOperatorsMap.get(op as SearchOperators)!;

				if (op === 'message:') {
					parseSearchMessageOperations(value, operations);
				} else {
					let values = operations.get(op);
					if (values === undefined) {
						values = [value];
						operations.set(op, values);
					} else {
						values.push(value);
					}
				}
			}
		} while (true);

		return operations;
	}

	function parseSearchMessageOperations(message: string, operations: Map<string, string[]>) {
		let values = operations.get('message:');

		if (message === emptyStr) {
			if (values === undefined) {
				values = [''];
				operations.set('message:', values);
			} else {
				values.push('');
			}

			return;
		}

		let match;
		let value;
		do {
			match = searchMessageValuesRegex.exec(message);
			if (match == null) break;

			[, value] = match;

			if (values === undefined) {
				values = [value];
				operations.set('message:', values);
			} else {
				values.push(value);
			}
		} while (true);
	}

	export function toKey(search: SearchPattern) {
		return `${search.pattern}|${search.matchAll ? 'A' : ''}${search.matchCase ? 'C' : ''}${
			search.matchRegex ? 'R' : ''
		}`;
	}
}
export const normalizeSearchOperatorsMap = new Map<SearchOperators, SearchOperators>([
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
