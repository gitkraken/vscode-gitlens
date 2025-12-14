type SearchOperatorsShortForm = '' | '=:' | '@:' | '#:' | '?:' | '~:' | 'is:' | '>:' | '<:' | '^:';
export type SearchOperatorsLongForm =
	| 'message:'
	| 'author:'
	| 'commit:'
	| 'file:'
	| 'change:'
	| 'type:'
	| 'after:'
	| 'since:'
	| 'before:'
	| 'until:'
	| 'ref:';
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
	'>:',
	'after:',
	'since:',
	'<:',
	'before:',
	'until:',
	'^:',
	'ref:',
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
	['>:', 'after:'],
	['after:', 'after:'],
	['since:', 'after:'],
	['<:', 'before:'],
	['before:', 'before:'],
	['until:', 'before:'],
	['^:', 'ref:'],
	['ref:', 'ref:'],
]);

export const searchOperationHelpRegex =
	/(?:^|(\b|\s)*)((=:|message:|@:|author:|#:|commit:|\?:|file:|~:|change:|is:|type:|>:|after:|since:|<:|before:|until:|\^:|ref:)(?:"[^"]*"?|[^\s]*))(?:$|(\b|\s))/g;

export interface SearchQuery {
	query: string;
	naturalLanguage?: boolean | { query: string; processedQuery?: string; error?: string };

	filter?: boolean;
	matchAll?: boolean;
	matchCase?: boolean;
	matchRegex?: boolean;
	matchWholeWord?: boolean;
}
