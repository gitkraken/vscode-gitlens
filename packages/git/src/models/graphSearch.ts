import type { SearchQuery, SearchQueryFilters } from './search.js';

export interface GitGraphSearchResultData {
	readonly date: number;
	readonly i: number;
	readonly files?: ReadonlyArray<Readonly<{ readonly path: string }>>;
}
export type GitGraphSearchResults = Map<string, GitGraphSearchResultData>;

export interface GitGraphSearchProgress {
	readonly repoPath: string;
	readonly query: SearchQuery;
	readonly queryFilters: SearchQueryFilters;
	readonly comparisonKey: string;
	/** Whether there are more results available beyond the current limit */
	readonly hasMore: boolean;
	/** New results since the last progress update */
	readonly results: GitGraphSearchResults;
	/** Total count of all results accumulated so far */
	readonly runningTotal: number;
}

export interface CliGitGraphSearchCursorState {
	readonly iterations: number;
	readonly totalSeen: number;
	readonly sha: string;
	readonly skip: number;
}

export type GitGraphSearchCursorState = CliGitGraphSearchCursorState | string;

export interface GitGraphSearchCursor {
	readonly search: SearchQuery;
	readonly state: GitGraphSearchCursorState;
}

export interface GitGraphSearch {
	readonly repoPath: string;
	readonly query: SearchQuery;
	readonly queryFilters: SearchQueryFilters;
	readonly comparisonKey: string;
	/** Whether there are more results available beyond the current limit */
	readonly hasMore: boolean;
	/** Complete set of results up to the current limit */
	readonly results: GitGraphSearchResults;

	readonly paging?: {
		readonly limit: number | undefined;
		readonly cursor?: GitGraphSearchCursor;
	};

	more?(limit: number): Promise<GitGraphSearch>;
}
