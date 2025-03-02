type SearchOperatorsShortForm = '' | '=:' | '@:' | '#:' | '?:' | '~:' | 'is:';
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
	'is:',
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
	['is:', 'type:'],
	['type:', 'type:'],
]);

export const searchOperationRegex =
	/(?:(?<op>=:|message:|@:|author:|#:|commit:|\?:|file:|~:|change:|is:|type:)\s?(?<value>".+?"|\S+}?))|(?<text>\S+)(?!(?:=|message|@|author|#|commit|\?|file|~|change|is|type):)/g;

export const searchOperationHelpRegex =
	/(?:^|(\b|\s)*)((=:|message:|@:|author:|#:|commit:|\?:|file:|~:|change:|is:|type:)(?:"[^"]*"?|\w*))(?:$|(\b|\s))/g;

export interface SearchQuery {
	query: string;
	filter?: boolean;
	matchAll?: boolean;
	matchCase?: boolean;
	matchRegex?: boolean;
}
