import type { GitGraph, GraphRowProcessor } from '../models/graph.js';
import type {
	GitGraphSearch,
	GitGraphSearchCursor,
	GitGraphSearchProgress,
	GitGraphSearchResults,
} from '../models/graphSearch.js';
import type { SearchQuery } from '../models/search.js';

export interface GitGraphSubProvider {
	getGraph(
		repoPath: string,
		rev: string | undefined,
		options?: { include?: { stats?: boolean }; limit?: number; rowProcessor?: GraphRowProcessor },
		cancellation?: AbortSignal,
	): Promise<GitGraph>;
	searchGraph(
		repoPath: string,
		search: SearchQuery,
		options?: { limit?: number; ordering?: 'date' | 'author-date' | 'topo' },
		cancellation?: AbortSignal,
	): AsyncGenerator<GitGraphSearchProgress, GitGraphSearch, void>;
	continueSearchGraph(
		repoPath: string,
		cursor: GitGraphSearchCursor,
		existingResults: GitGraphSearchResults,
		options?: { limit?: number },
		cancellation?: AbortSignal,
	): AsyncGenerator<GitGraphSearchProgress, GitGraphSearch, void>;
}
