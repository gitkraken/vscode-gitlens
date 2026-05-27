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

export interface GitCommitSearchContext {
	readonly query: SearchQuery;
	readonly queryFilters: SearchQueryFilters;
	readonly matchedFiles: ReadonlyArray<Readonly<{ readonly path: string }>>;
	/** Whether the commit is hidden from the graph (filtered out by type or other filters) */
	readonly hiddenFromGraph?: boolean;
}

/** Operators plus special tokens that can be highlighted */
export type HighlightableOperator = SearchOperators | '@me';

export interface ParsedSearchQuery {
	operations: Map<SearchOperatorsLongForm, Set<string>>;
	errors?: string[];
	/** Positions of operators in the original query string */
	operatorRanges?: { start: number; end: number; operator: HighlightableOperator }[];
}

export interface SearchQueryFilters {
	/** Specifies whether the search results will be filtered to specific files */
	files: boolean;
	/** Specifies whether the search results will be filtered to a specific type, only `stash`, `tip`, and `wip` are supported */
	type?: 'stash' | 'tip' | 'wip';
	/** Specifies whether the search results will be filtered to a specific ref or ref range */
	refs: boolean;
}

export interface SearchQueryGitCommand {
	/** Git log args */
	args: string[];
	/** Pathspecs to search, if any */
	files: string[];
	/** SHAs to search, if any */
	shas?: Set<string> | undefined;

	filters: SearchQueryFilters;
	operations: Map<SearchOperatorsLongForm, Set<string>>;
}

export interface SearchQueryGitHubCommand {
	/** Query args */
	args: string[];

	filters: SearchQueryFilters;
	operations: Map<SearchOperatorsLongForm, Set<string>>;
}
