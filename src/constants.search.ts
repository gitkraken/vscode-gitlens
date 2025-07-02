type SearchOperatorsShortForm = '' | '=:' | '@:' | '#:' | '?:' | '~:' | 'is:' | '>:' | '<:';
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
	| 'until:';
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
]);

export const searchOperationHelpRegex =
	/(?:^|(\b|\s)*)((=:|message:|@:|author:|#:|commit:|\?:|file:|~:|change:|is:|type:|>:|after:|since:|<:|before:|until:)(?:"[^"]*"?|\w*))(?:$|(\b|\s))/g;

export interface SearchQuery {
	query: string;
	filter?: boolean;
	matchAll?: boolean;
	matchCase?: boolean;
	matchRegex?: boolean;
	matchWholeWord?: boolean;
}
