type SearchOperatorsShortForm = '' | '=:' | '@:' | '#:' | '?:' | '~:';
export type SearchOperatorsLongForm = 'message:' | 'author:' | 'commit:' | 'file:' | 'change:' | 'type:';
export type SearchOperators = SearchOperatorsShortForm | SearchOperatorsLongForm;

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

export const searchOperatorsToLongFormMap = new Map<SearchOperators, SearchOperatorsLongForm>([
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

export const searchOperationHelpRegex =
	/(?:^|(\b|\s)*)((=:|message:|@:|author:|#:|commit:|\?:|file:|~:|change:|type:)(?:"[^"]*"?|\w*))(?:$|(\b|\s))/g;

export interface SearchQuery {
	query: string;
	matchAll?: boolean;
	matchCase?: boolean;
	matchRegex?: boolean;
}
