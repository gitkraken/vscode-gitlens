export type NormalizedSearchOperators = 'message:' | 'author:' | 'commit:' | 'file:' | 'change:' | 'type:';
export type SearchOperators = NormalizedSearchOperators | '' | '=:' | '@:' | '#:' | '?:' | '~:';

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
	'type:',
]);

export const normalizeSearchOperatorsMap = new Map<SearchOperators, NormalizedSearchOperators>([
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
	['type:', 'type:'],
]);

export const searchOperationRegex =
	/(?:(?<op>=:|message:|@:|author:|#:|commit:|\?:|file:|~:|change:|type:)\s?(?<value>".+?"|\S+}?))|(?<text>\S+)(?!(?:=|message|@|author|#|commit|\?|file|~|change|type):)/g;

export interface SearchQuery {
	query: string;
	matchAll?: boolean;
	matchCase?: boolean;
	matchRegex?: boolean;
}
