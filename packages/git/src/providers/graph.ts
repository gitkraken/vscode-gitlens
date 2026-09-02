import type {
	GitGraph,
	GitGraphRowsStats,
	GraphIncrementalSeed,
	GraphReachabilityTable,
	GraphRowProcessor,
	IncrementalGraphOutcome,
} from '../models/graph.js';
import type {
	GitGraphSearch,
	GitGraphSearchCursor,
	GitGraphSearchProgress,
	GitGraphSearchResults,
} from '../models/graphSearch.js';
import type { GitGraphSession } from '../models/graphSession.js';
import type { SearchQuery } from '../models/search.js';

export interface GitGraphSubProvider {
	/**
	 * Opens a stateful {@link GitGraphSession} for `repoPath` — the canonical accumulated graph window and
	 * the single builder of incremental rebuild seeds. Performs the initial walk (equivalent to a first
	 * `getGraph` with no seed); subsequent rebuilds go through `session.refresh()`, pagination through
	 * `session.more()`. Prefer this over `getGraph` for a live, repeatedly-refreshed window; `getGraph`
	 * remains for one-shot walks (and is what the session is built on).
	 */
	openGraphSession(
		repoPath: string,
		options?: {
			rowProcessor?: GraphRowProcessor;
			rev?: string;
			limit?: number;
			include?: { stats?: boolean };
		},
		cancellation?: AbortSignal,
	): Promise<GitGraphSession>;
	getGraph(
		repoPath: string,
		rev: string | undefined,
		options?: {
			include?: { stats?: boolean };
			limit?: number;
			rowProcessor?: GraphRowProcessor;
			/**
			 * Prior generation's reachability table to CONTINUE (same repo rebuilds only). Keeps
			 * `reachabilityIndex` values stable for unchanged rows, which is what lets the caller ship a
			 * rows splice-delta instead of the full row set. See `createReachabilityTableBuilder`.
			 */
			reachabilitySeed?: GraphReachabilityTable;
			/**
			 * Prior generation's per-sha stats to CONTINUE (same-repo rebuilds only). Stats are immutable per
			 * sha, so the deferred stats query recomputes only shas absent from the seed.
			 */
			rowsStatsSeed?: GitGraphRowsStats;
			/**
			 * R6b incremental head-walk seed. When present (and the gate holds) the Node provider walks only the
			 * changed head region, stitches the seed's cached tail, and re-derives flags/reachability in memory
			 * instead of re-walking every loaded row. Any structural change (ref deletion, non-fast-forward move,
			 * stash-set change, old-dated interleave, …) degrades to the full walk. See {@link GraphIncrementalSeed}.
			 */
			incrementalSeed?: GraphIncrementalSeed;
			/**
			 * Observational callback invoked once per seeded call reporting whether the fast path was taken or a
			 * full fallback occurred (with the reason). Never affects the returned graph. See
			 * {@link IncrementalGraphOutcome}.
			 */
			onIncrementalResult?: (outcome: IncrementalGraphOutcome) => void;
			/**
			 * Set only by {@link GitGraphSession.rebind} — the path the session was bound to before this call.
			 * Enables the rebind fast path: unchanged tips, HEAD endpoints refetched, flags/reachability
			 * replayed over the existing window, and every row's `repoPath`-derived decorations re-stamped
			 * from this path onto `repoPath` (see {@link GraphRowProcessor.restampRow}).
			 */
			rebindFromRepoPath?: string;
		},
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
	/**
	 * Counts commits matching `search` without materializing results — used to probe whether a relaxed
	 * (broadened) variant of a zero-result search would actually find anything, before offering it as a
	 * calm inline chip. Optional: providers that can't cheaply count (e.g. GitHub) simply omit it, and
	 * callers treat a missing implementation the same as "no relaxations available" (never an error).
	 */
	countSearchResults?(
		repoPath: string,
		search: SearchQuery,
		options?: { maxCount?: number },
		cancellation?: AbortSignal,
	): Promise<number>;
}
