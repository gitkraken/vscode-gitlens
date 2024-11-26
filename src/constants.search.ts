type SearchOperatorsShortForm = '' | '=:' | '@:' | '#:' | '?:' | '~:' | 'is:' | 'after:' | 'before:';
export type SearchOperatorsLongForm =
	| 'message:'
	| 'author:'
	| 'commit:'
	| 'file:'
	| 'change:'
	| 'type:'
	| 'after:'
	| 'before:';
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
	'after:',
	'before:',
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
	['after:', 'after:'],
	['before:', 'before:'],
]);

export const searchOperationRegex =
	/(?:(?<op>=:|message:|@:|author:|#:|commit:|\?:|file:|~:|change:|is:|type:|after:|before:)\s?(?<value>".+?"|\S+}?))|(?<text>\S+)(?!(?:=|message|@|author|#|commit|\?|file|~|change|is|type):)/g;

export const searchOperationHelpRegex =
	/(?:^|(\b|\s)*)((=:|message:|@:|author:|#:|commit:|\?:|file:|~:|change:|is:|type:|after:|before:)(?:"[^"]*"?|\w*))(?:$|(\b|\s))/g;

export interface SearchQuery {
	query: string;
	filter?: boolean;
	matchAll?: boolean;
	matchCase?: boolean;
	matchRegex?: boolean;
}
