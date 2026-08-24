import type { CancellationTokenSource } from 'vscode';
import { GitSearchError } from '@gitlens/git/errors.js';
import type { GitGraph } from '@gitlens/git/models/graph.js';
import type { GitGraphSearch, GitGraphSearchProgress, GitGraphSearchResults } from '@gitlens/git/models/graphSearch.js';
import type { GitGraphSession } from '@gitlens/git/models/graphSession.js';
import type {
	GitCommitSearchContext,
	ParsedSearchQuery,
	SearchOperatorsLongForm,
	SearchQuery,
} from '@gitlens/git/models/search.js';
import {
	getSearchQueryComparisonKey,
	parseSearchQuery,
	parseSearchQueryGitCommand,
	rebuildSearchQueryFromParsed,
} from '@gitlens/git/utils/search.utils.js';
import { isCancellationError, raceWithSignal } from '@gitlens/utils/cancellation.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import { fuzzyFilter } from '@gitlens/utils/fuzzy.js';
import { join } from '@gitlens/utils/iterable.js';
import { Logger } from '@gitlens/utils/logger.js';
import { basename } from '@gitlens/utils/path.js';
import { cancellable, getSettledValue, getSettledValues } from '@gitlens/utils/promise.js';
import { Stopwatch } from '@gitlens/utils/stopwatch.js';
import type { Container } from '../../../container.js';
import type { GlRepository } from '../../../git/models/repository.js';
import { processNaturalLanguageToSearchQuery } from '../../../git/search.naturalLanguage.js';
import type { NaturalLanguageSearchOptions } from '../../../plus/search/naturalLanguageSearchProcessor.js';
import { cancelAndDispose, fromAbortSignal } from '../../../system/-webview/cancellation.js';
import { configuration } from '../../../system/-webview/configuration.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from '../../rpc/eventVisibilityBuffer.js';
import { createRpcEvent } from '../../rpc/eventVisibilityBuffer.js';
import type { WebviewHost } from '../../webviewProvider.js';
import type { GraphSearchResponse, GraphSearchState, GraphServices } from './graphService.js';
import type { SelectedRowState } from './graphWebview.js';
import { createWipRowId } from './protocol.js';
import type {
	DidRequestSearchParams,
	DidSearchHistoryGetParams,
	DidSearchRepairParams,
	GraphSearchMode,
	GraphSearchRelaxation,
	GraphSearchResults,
	GraphSearchResultsError,
	GraphSelection,
	GraphWipRowsById,
	SearchParams,
} from './protocol.js';
import { SearchHistory } from './searchHistory.js';

/** Collaborators the search cluster reaches for on the host provider, assembled by
 *  `GraphWebviewProvider.createGraphSearchContext()`. `getRepository`/`getSession` read live provider
 *  state; the selection/etag reads and `setSelectedRows` route through the provider's selection state
 *  (kept there); `updateState`/`updateGraphWithMoreRows`/`notifyDidChangeRows` forward into the data
 *  controller; `getWipRows` forwards into the WIP service. */
export type GraphSearchServiceContext = {
	container: Container;
	host: WebviewHost<'gitlens.views.graph' | 'gitlens.graph'>;
	getRepository: () => GlRepository | undefined;
	getSession: () => GitGraphSession | undefined;
	getSelectedId: () => string | undefined;
	getSelectedRows: () => Record<string, SelectedRowState> | undefined;
	getEtagRepository: () => number | undefined;
	setSelectedRows: (id: string | undefined, selection?: GraphSelection[], state?: SelectedRowState) => void;
	updateState: (immediate?: boolean) => void;
	updateGraphWithMoreRows: (id: string, limitOverride?: number) => Promise<void>;
	notifyDidChangeRows: (sendSelectedRows?: boolean) => void;
	getWipRows: () => Promise<GraphWipRowsById>;
	/** Overrides {@link GraphSearchService.convertNaturalLanguage}'s defensive AI round-trip timeout
	 *  (default 30000ms) — test-only seam, never set in production. */
	nlConversionTimeoutMs?: number;
};

/** Turns a search failure into the webview-facing {@link GraphSearchResultsError}. A classified
 *  {@link GitSearchError} (pattern/ref) gets wording naming the problem; anything else (including an
 *  unclassified `GitSearchError`) falls back to a generic message so we never claim more precision than
 *  the classifier actually found. */
export function toGraphSearchResultsError(ex: unknown): GraphSearchResultsError {
	if (GitSearchError.is(ex) && ex.reason != null) {
		switch (ex.reason) {
			case 'invalidPattern':
				return {
					error: `Invalid regular expression${ex.detail ? `: ${ex.detail}` : ''}`,
					reason: ex.reason,
					detail: ex.detail,
				};
			case 'invalidRef':
				return {
					error:
						ex.detail == null
							? 'Unknown reference'
							: ex.detail.includes('..')
								? `Unknown reference '${ex.detail}'`
								: `No branch or tag named '${ex.detail}'`,
					reason: ex.reason,
					detail: ex.detail,
				};
		}
	}

	return { error: 'Something went wrong searching' };
}

/** Narrows a search results union to its error shape. */
function isSearchResultsError(
	results: GraphSearchResults | GraphSearchResultsError | undefined,
): results is GraphSearchResultsError {
	return results != null && 'error' in results;
}

/** One drop-one-group or AI-alternate candidate query a zero-result NL search could relax to — not yet
 *  counted. See {@link buildSearchRelaxationCandidates}. */
export interface SearchRelaxationCandidate {
	label: string;
	query: string;
}

/** The droppable operator groups a relaxation candidate removes, in the order candidates are offered.
 *  `after:`/`before:` are ONE group ("the date filter") — dropping one without the other rarely helps,
 *  since a lone `after:` or `before:` is still a real bound. `type:` and `commit:` are never droppable:
 *  `commit:` is an exact lookup a broader search can't approximate, and `type:` (stash/tip/wip) changes
 *  the KIND of thing searched, not a filter narrowing it. */
const relaxationGroups: readonly { operators: readonly SearchOperatorsLongForm[]; label: string }[] = [
	{ operators: ['after:', 'before:'], label: 'without the date filter' },
	{ operators: ['author:'], label: 'without the author filter' },
	{ operators: ['committer:'], label: 'without the committer filter' },
	{ operators: ['file:'], label: 'without the file filter' },
	{ operators: ['ref:'], label: 'across all branches' },
	{ operators: ['change:'], label: 'without the change filter' },
	{ operators: ['message:'], label: 'without the message terms' },
	{ operators: ['-message:'], label: 'without the message exclusion' },
];

/**
 * True when `a` and `b` are close enough to be the same word with a typo: case-insensitive equal,
 * containment either direction (only once the shorter string is at least 4 characters — anything
 * shorter is too noisy), or within Damerau-Levenshtein (transposition-aware) edit distance of a
 * length-scaled threshold (only once BOTH strings are at least 4 characters). Used for typo-tolerant
 * author/contributor matching, the same job {@link fuzzyFilter} does for refs — but `fuzzyFilter` is
 * subsequence-based and can't catch a transposition like 'kieth' vs 'keith', which this can.
 */
export function isCloseMatch(a: string, b: string): boolean {
	const aLower = a.toLowerCase();
	const bLower = b.toLowerCase();
	if (aLower === bLower) return true;

	const minLength = Math.min(aLower.length, bLower.length);
	if (minLength >= 4 && (aLower.includes(bLower) || bLower.includes(aLower))) return true;

	if (minLength < 4) return false;
	// Edit distance is always >= the length difference, so once lengths diverge past the largest
	// possible threshold (2), no distance computation can still land within it — skip the DP table.
	if (Math.abs(aLower.length - bLower.length) > 2) return false;

	const maxLength = Math.max(aLower.length, bLower.length);
	const threshold = maxLength <= 5 ? 1 : 2;
	return damerauLevenshteinDistance(aLower, bLower) <= threshold;
}

/** Standard Damerau-Levenshtein (transposition-aware) edit distance via a full DP table — small inputs
 *  only (author names / search tokens), bounded by {@link isCloseMatch}'s early-out above. */
function damerauLevenshteinDistance(a: string, b: string): number {
	const lenA = a.length;
	const lenB = b.length;
	const d: number[][] = Array.from({ length: lenA + 1 }, () => new Array<number>(lenB + 1).fill(0));

	for (let i = 0; i <= lenA; i++) {
		d[i][0] = i;
	}
	for (let j = 0; j <= lenB; j++) {
		d[0][j] = j;
	}

	for (let i = 1; i <= lenA; i++) {
		for (let j = 1; j <= lenB; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);

			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
				d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
			}
		}
	}

	return d[lenA][lenB];
}

/**
 * Builds the CANDIDATE (uncounted) relaxations for a settled zero-result query: up to 2 author/committer
 * RESPELL variants per misspelled value (see below), one "drop this group" variant per droppable operator
 * group present (only when ≥2 distinct groups are present — dropping the only filter just re-runs an
 * unfiltered search, which isn't a relaxation offer), plus up to 2 of the AI's own `alternates` (labeled
 * with their own query text). Respell candidates are listed FIRST — a corrected name is a stronger, more
 * specific offer than "drop the filter entirely". Pure and side-effect-free so it's unit testable without
 * the service; the caller is responsible for counting each candidate and keeping only the ones that find
 * something.
 *
 * Respell: for each unquoted, non-`@me` `author:`/`committer:` value that ISN'T already an exact
 * (case-insensitive) match to a known contributor's full name, a name word, or their email local-part,
 * find up to 2 contributors {@link isCloseMatch} recognizes it as a probable typo of (via full name, a
 * name word, or the email local-part) and offer each as `author:"Full Name"` (quoted, so a later respell
 * pass never mistakes the correction itself for another misspelling). A QUOTED author value is presumed a
 * deliberate exact name, not a typo in need of correcting, and is never a respell candidate.
 */
export function buildSearchRelaxationCandidates(
	parsed: ParsedSearchQuery,
	alternates?: string[],
	contributors?: Array<{ name: string; email: string | undefined }>,
): SearchRelaxationCandidate[] {
	const candidates: SearchRelaxationCandidate[] = [];
	const seen = new Set<string>();

	if (contributors?.length) {
		for (const op of ['author:', 'committer:'] as const) {
			const values = parsed.operations.get(op);
			if (!values?.size) continue;

			for (const value of values) {
				if (value === '@me') continue;
				if (value.startsWith('"') && value.endsWith('"')) continue;

				const valueLower = value.toLowerCase();
				const alreadyRecognized = contributors.some(c => {
					const nameLower = c.name.toLowerCase();
					const emailLocal = c.email?.split('@')[0].toLowerCase();
					return (
						valueLower === nameLower ||
						nameLower.split(/\s+/).includes(valueLower) ||
						valueLower === emailLocal
					);
				});
				if (alreadyRecognized) continue;

				const matches = contributors
					.filter(c => {
						const emailLocal = c.email?.split('@')[0].toLowerCase();
						return (
							isCloseMatch(value, c.name) ||
							c.name.split(/\s+/).some(word => isCloseMatch(value, word)) ||
							(emailLocal != null && isCloseMatch(value, emailLocal))
						);
					})
					.slice(0, 2);

				for (const contributor of matches) {
					const operations = new Map(parsed.operations);
					const newValues = new Set(values);
					newValues.delete(value);
					newValues.add(`"${contributor.name}"`);
					operations.set(op, newValues);

					const query = rebuildSearchQueryFromParsed({ operations: operations });
					if (!query || seen.has(query)) continue;

					seen.add(query);
					candidates.push({ label: `as '${contributor.name}'`, query: query });
				}
			}
		}
	}

	const presentGroups = relaxationGroups.filter(group => group.operators.some(op => parsed.operations.get(op)?.size));
	if (presentGroups.length >= 2) {
		for (const group of presentGroups) {
			const operations = new Map(parsed.operations);
			for (const op of group.operators) {
				operations.delete(op);
			}
			if (!operations.size) continue;

			const query = rebuildSearchQueryFromParsed({ operations: operations });
			if (!query || seen.has(query)) continue;

			seen.add(query);
			candidates.push({ label: group.label, query: query });
		}
	}

	for (const alternate of alternates?.slice(0, 2) ?? []) {
		const query = alternate.trim();
		if (!query || seen.has(query)) continue;

		seen.add(query);
		candidates.push({ label: query, query: query });
	}

	return candidates;
}

/** AI repair context: the query that failed to compile and git's complaint about it. Shared by the
 *  NL-search auto-repair path and the manual repair request, so both ask for the same thing — worded
 *  for either origin, since the manual path's query is the user's own and often has no git detail. */
function buildRepairContext(query: string, error: string | undefined): string {
	return `The previous search query \`${query}\` failed to compile.${
		error ? `\nGit reported: ${error}` : ''
	}\nReturn a corrected search query that preserves the original intent.`;
}

/** Host-side search cluster for the graph RPC surface. Owns the active graph search (`_search`), its
 *  app-facing projection (`_current`), and the per-repo search history (`_searchHistoryByRepo`), along with
 *  the search-execution logic (new/continue/WIP streams, abort-driven supersede handling), the
 *  search-results serialization, and the mode/history/open-in-view/repair handlers. Exposes its RPC surface
 *  via {@link GraphSearchService.createServices} and its push channels via
 *  `onDidChange`/`onDidRequestSearch`. */
export class GraphSearchService {
	private _search: GitGraphSearch | undefined;
	/** One {@link SearchHistory} instance per repo, kept alive for the life of the service instead of being
	 *  torn down on repo switch — each instance owns its own write-serialization chain
	 *  ({@link SearchHistory._writes}), so replacing the instance on every repo change would lose that
	 *  serialization (and so a lost update) across an A→B→A repo switch. */
	private readonly _searchHistoryByRepo = new Map<string | undefined, SearchHistory>();

	/** The query+results the app should currently show. Decoupled from `_search` (which additionally
	 *  carries git-continuation bookkeeping and stays `undefined` for a failure that never reached git,
	 *  e.g. an NL conversion error) so a failure can still be shown. `undefined` means no active search.
	 *  The single source `buildSearchState` reads from — every site that changes what's shown writes
	 *  here (directly, or via `syncCurrent` when it mirrors `_search`). */
	private _current:
		| { query: SearchQuery; results: GraphSearchResults | GraphSearchResultsError | undefined }
		| undefined;

	/** Whether a `search()` call is currently executing — read by {@link GraphSearchService.getState} for
	 *  a pull that lands while a search is still in flight. */
	private _searching = false;

	/** Set by {@link cancel} (a pause) and cleared by the next `search()`/`clear()`. Aborting the
	 *  operations in flight at pause time isn't enough: a rows page-in landing AFTER the pause starts a
	 *  fresh background continuation under a fresh signal, which would run the rest of the walk and
	 *  publish the full tally (`hasMore: false`) over the paused state — killing the resume affordance
	 *  ~15s after the user stopped. While paused, background continuations decline to start. */
	private _paused = false;

	/**
	 * Set for the lifetime of a search (through its `e.more` continuations) that recovered from an
	 * invalid-regex pattern by matching literally instead — a pattern mid-keystroke (e.g. `fix(`) fails
	 * to compile constantly, and flashing an error on every one is worse than quietly matching literally
	 * until the pattern completes. Cleared the moment a genuinely new search starts.
	 */
	private _fallback: { detail?: string } | undefined;

	/** Counted relaxation offers for the currently-active zero-result NL search, or `undefined` when none
	 *  are active. Mirrors `_fallback`'s lifecycle: cleared at the start of every NEW search, set once
	 *  {@link offerSearchRelaxations} finishes probing. */
	private _relaxations: GraphSearchRelaxation[] | undefined;

	/** One `AbortController` per in-flight `search()`/`continueInBackground()`/`repair()` call, so
	 *  `dispose()`/`clear()` can abort whatever is still running. */
	private readonly _operations = new Set<AbortController>();
	/** `fromAbortSignal` bridges created for in-flight AI round-trips (NL conversion, repair), tracked so
	 *  `dispose()` can cancel them even though their driving operation signal already fires the abort. */
	private readonly _aiCancellations = new Set<CancellationTokenSource>();

	private readonly _searchStateEvent = createRpcEvent<GraphSearchState | undefined>('searchState', 'save-last');
	private readonly _requestSearchEvent = createRpcEvent<DidRequestSearchParams>('requestSearch', 'save-last');

	constructor(private readonly context: GraphSearchServiceContext) {}

	private get container(): Container {
		return this.context.container;
	}
	private get host(): WebviewHost<'gitlens.views.graph' | 'gitlens.graph'> {
		return this.context.host;
	}
	private get repository(): GlRepository | undefined {
		return this.context.getRepository();
	}

	/** The active graph search (accumulated results). Read by the data controller (page-in / auto-load)
	 *  and `getSearchContext`. */
	get activeSearch(): GitGraphSearch | undefined {
		return this._search;
	}

	createServices(buffer?: EventVisibilityBuffer, tracker?: SubscriptionTracker): Pick<GraphServices, 'search'> {
		const search = {
			search: (params: SearchParams, signal?: AbortSignal) => this.search(params, signal),
			getState: () => this.getState(),
			cancel: () => this.cancel(),
			clear: () => this.clear(),
			setMode: (searchMode: GraphSearchMode | undefined, useNaturalLanguage: boolean) =>
				this.setMode(searchMode, useNaturalLanguage),
			openInView: (search: SearchQuery) => this.openInView(search),
			repair: (query: string, detail?: string) => this.repair(query, detail),
			getHistory: () => this.getHistory(),
			storeHistory: (search: SearchQuery) => this.storeHistory(search),
			deleteHistory: (query: string) => this.deleteHistory(query),
			onDidChange: this._searchStateEvent.subscribe(buffer, tracker),
			onDidRequestSearch: this._requestSearchEvent.subscribe(buffer, tracker),
			// Collected by `proxyServices` (a top-level property with a `dispose` method) and released at
			// webview teardown — see `disposeServices`.
			dispose: () => this.dispose(),
		};
		return { search: search };
	}

	dispose(): void {
		// The webview's driving AbortController can't fire once the webview is gone — cancel host-side so
		// no in-flight search or AI round-trip resolves against a torn-down host.
		for (const operation of this._operations) {
			operation.abort();
		}
		this._operations.clear();
		cancelAndDispose(this._aiCancellations);
		this._aiCancellations.clear();
	}

	/** {@link _fallback} as the wire payload, or `undefined` when no fallback is active for the current search. */
	private buildFallbackParam(): GraphSearchState['fallback'] {
		return this._fallback != null ? { matchedAs: 'literal', detail: this._fallback.detail } : undefined;
	}

	/** `query` with `matchRegex` forced back to `true` while {@link _fallback} is active — the query stored
	 *  on `_search` stays the executed (literal) one (paging cursors and `comparisonKey` need it), but
	 *  nothing webview-facing may show the regex toggle as off. */
	private publicSearchQuery(query: SearchQuery): SearchQuery {
		return this._fallback != null ? { ...query, matchRegex: true } : query;
	}

	/** Assembles the complete snapshot from {@link _current}/{@link _fallback}/{@link _relaxations} plus the
	 *  given `searching` flag — the only place that builds a {@link GraphSearchState}, so no fire site can
	 *  drift into shipping a delta. `undefined` when there's no active search to show. */
	private buildSearchState(searching: boolean): GraphSearchState | undefined {
		if (this._current == null) return undefined;

		return {
			query: this._current.query,
			results: this._current.results,
			searching: searching,
			fallback: this.buildFallbackParam(),
			relaxations: this._relaxations,
		};
	}

	/** Recomputes {@link _current} from {@link _search} (or clears it when `_search` is `undefined`) —
	 *  called after every write to `_search` so the two never drift. */
	private syncCurrent(): void {
		this._current =
			this._search != null
				? {
						query: this.publicSearchQuery(this._search.query),
						results: this.getSearchResultsData(this._search) ?? {
							count: 0,
							hasMore: this._search.hasMore ?? false,
						},
					}
				: undefined;
	}

	/** Resets the three search-tracking fields a NEW search (or one that's stopped applying to anything
	 *  live) shares — `_search`/`_fallback`/`_relaxations` all going back to "no active search". Never
	 *  touches `_current` — callers reset that themselves, since not every reset site wants it cleared at
	 *  the same point (e.g. {@link clear} sets it to `undefined`, a new search sets it to the new query). */
	private resetSearchTracking(): void {
		this._search = undefined;
		this._fallback = undefined;
		this._relaxations = undefined;
	}

	/** Shows a "No repository" failure as the current search state — shared by the sites that hit this
	 *  precondition; each keeps its own return since what's appropriate to return differs by caller. */
	private showNoRepositoryError(query: SearchQuery): void {
		this._current = { query: query, results: { error: 'No repository' } };
		this._searchStateEvent.fire(this.buildSearchState(false));
	}

	/** Returns the search-history instance for the CURRENT repo, get-or-creating it in
	 *  {@link _searchHistoryByRepo} — so a repo switch always reads/writes the right repo's history, and
	 *  switching back to a repo already seen in this session reuses its instance (and write-serialization
	 *  chain) instead of losing it to a fresh one. */
	private getSearchHistory(): SearchHistory {
		const repoPath = this.repository?.path;
		let searchHistory = this._searchHistoryByRepo.get(repoPath);
		if (searchHistory == null) {
			searchHistory = new SearchHistory(this.container.storage, repoPath);
			this._searchHistoryByRepo.set(repoPath, searchHistory);
		}
		return searchHistory;
	}

	getHistory(): Promise<DidSearchHistoryGetParams> {
		const searchHistory = this.getSearchHistory();
		try {
			return Promise.resolve({ history: searchHistory.get() });
		} catch {
			return Promise.resolve({ history: [] });
		}
	}

	async storeHistory(search: SearchQuery): Promise<DidSearchHistoryGetParams> {
		const searchHistory = this.getSearchHistory();

		try {
			await searchHistory.store(search);
			return { history: searchHistory.get() };
		} catch (ex) {
			Logger.error(ex, 'GraphSearchService', 'storeHistory');
			// Surface storage errors to the frontend instead of swallowing and pretending success — the
			// user thought the entry was saved; on reload it would be missing.
			return { history: searchHistory.get(), error: ex instanceof Error ? ex.message : String(ex) };
		}
	}

	async deleteHistory(query: string): Promise<DidSearchHistoryGetParams> {
		const searchHistory = this.getSearchHistory();
		try {
			await searchHistory.delete(query);
			return { history: searchHistory.get() };
		} catch (ex) {
			Logger.error(ex, 'GraphSearchService', 'deleteHistory');
			return { history: searchHistory.get(), error: ex instanceof Error ? ex.message : String(ex) };
		}
	}

	/** Drops the active search and everything accumulated for it, aborting whatever operation is still
	 *  running. Pausing (without dropping) is just the caller aborting `search()`'s own signal. */
	/** Aborts every in-flight search operation — the RPC request's own work AND the data controller's
	 *  background continuations, which run under their own signals precisely so a superseding search
	 *  doesn't kill them, and so are unreachable from the request signal a pause aborts. State stays:
	 *  each aborted stream drains to its cursor-bearing return, so the search can resume. Emits nothing;
	 *  the pausing app settles its own UI. */
	cancel(): void {
		this._paused = true;
		for (const operation of this._operations) {
			operation.abort();
		}
	}

	clear(): void {
		this._paused = false;
		for (const operation of this._operations) {
			operation.abort();
		}
		this.resetSearchTracking();
		this._current = undefined;
		this._searching = false;
		this._searchStateEvent.fire(undefined);
	}

	/**
	 * Builds a compact list of repo refs the user's sentence plausibly refers to, so NL search's AI
	 * conversion can resolve an approximate/partial name instead of hallucinating one that doesn't
	 * exist. Targeted, not exhaustive: only refs whose names overlap the sentence are included (plus
	 * the worktree/branch lists when the sentence says so), so most queries — which never mention a
	 * ref — pay no prompt-token cost at all. Best-effort and time-budgeted: any failure or a >200ms
	 * gather (uncached refs) returns undefined rather than delaying or breaking the AI call.
	 */
	private async buildRepoSearchContext(sentence: string): Promise<string | undefined> {
		const repository = this.repository;
		if (repository == null) return undefined;

		try {
			return await cancellable(this.buildRepoSearchContextCore(repository, sentence), 200, undefined, {
				onDidCancel: resolve => resolve(undefined),
			});
		} catch (ex) {
			Logger.error(ex, 'GraphSearchService', 'buildRepoSearchContext');
			return undefined;
		}
	}

	private async buildRepoSearchContextCore(repository: GlRepository, sentence: string): Promise<string | undefined> {
		const [
			worktreesResult,
			branchesResult,
			currentBranchResult,
			defaultBranchResult,
			contributorsResult,
			tagsResult,
		] = await Promise.allSettled([
			repository.git.worktrees?.getWorktrees() ?? Promise.resolve([]),
			repository.git.branches.getBranches({ filter: b => !b.remote, sort: { orderBy: 'date:desc' } }),
			repository.git.branches.getBranch(),
			repository.git.branches.getDefaultBranchName(undefined, { local: true }),
			repository.git.contributors.getContributorsLite(undefined, { since: '1 year ago' }),
			repository.git.tags.getTags({ sort: { orderBy: 'date:desc' } }),
		]);

		const worktrees = getSettledValue(worktreesResult) ?? [];
		const branches = getSettledValue(branchesResult)?.values ?? [];
		const currentBranch = getSettledValue(currentBranchResult);
		const defaultBranchName = getSettledValue(defaultBranchResult);
		const contributors = getSettledValue(contributorsResult) ?? [];
		const tags = getSettledValue(tagsResult)?.values ?? [];

		const lower = sentence.toLowerCase();
		// Tokens of 4+ chars so stopwords and short noise ('the', 'my', 'fix') can't match into every name
		const tokens = lower.split(/[^a-z0-9#._/-]+/).filter(t => t.length >= 4);
		const matchesSentence = (name: string): boolean => {
			const nameLower = name.toLowerCase();
			if (lower.includes(nameLower)) return true;

			return tokens.some(t => nameLower.includes(t));
		};

		const wantsWorktrees = lower.includes('worktree');
		const wantsBranches = lower.includes('branch');
		const wantsTags =
			lower.includes('tag') ||
			lower.includes('release') ||
			lower.includes('version') ||
			/\bv\d/.test(lower) ||
			/\d+\.\d+/.test(lower);

		const seen = new Set<string>();
		const lines: string[] = [];
		const add = (name: string, annotation?: string): void => {
			if (seen.has(name)) return;

			seen.add(name);
			lines.push(`- ${name}${annotation ? ` ${annotation}` : ''}`);
		};

		for (const worktree of worktrees) {
			const name = worktree.branch?.name ?? worktree.name;
			const folder = basename(worktree.path);
			if (wantsWorktrees || matchesSentence(name) || matchesSentence(folder)) {
				add(name, `(worktree "${folder}")`);
			}
		}

		if (defaultBranchName != null && (wantsBranches || matchesSentence(defaultBranchName))) {
			add(defaultBranchName, '(default)');
		}

		if (currentBranch != null && (wantsBranches || matchesSentence(currentBranch.name))) {
			add(currentBranch.name, '(current)');
		}

		let count = 0;
		for (const branch of branches) {
			if (lines.length >= 30 || count >= (wantsBranches ? 10 : 0) + 10) break;
			if (!wantsBranches && !matchesSentence(branch.name)) continue;
			if (seen.has(branch.name)) continue;

			add(branch.name);
			count++;
		}

		let tagCount = 0;
		for (const tag of tags) {
			if (lines.length >= 30 || tagCount >= 10) break;
			if (!wantsTags && !matchesSentence(tag.name)) continue;
			if (seen.has(tag.name)) continue;

			add(tag.name, '(tag)');
			tagCount++;
		}

		// Contributors match on name words or the email local-part, so 'by keith' or 'eamodio's commits'
		// resolves to a real author: value the way refs do
		const authorLines: string[] = [];
		for (const contributor of contributors) {
			if (authorLines.length >= 10) break;

			const nameLower = contributor.name.toLowerCase();
			const nameWords = nameLower.split(/\s+/).filter(w => w.length >= 4);
			const emailLocal = contributor.email?.split('@')[0].toLowerCase();
			const matched =
				lower.includes(nameLower) ||
				tokens.some(t => nameWords.some(w => isCloseMatch(t, w))) ||
				(emailLocal != null && emailLocal.length >= 4 && tokens.some(t => isCloseMatch(t, emailLocal)));
			if (!matched) continue;

			authorLines.push(`- ${contributor.name}${contributor.email ? ` <${contributor.email}>` : ''}`);
		}

		const sections: string[] = [];
		if (lines.length) {
			sections.push(
				`Repository refs (branches, tags, and worktrees) that exist:\n${lines.join('\n')}\nWhen the user refers to a branch, tag, or worktree by an approximate or partial name, resolve it to the closest ref from this list. Never invent ref names that are not in this list; if nothing matches, omit the ref: operator.`,
			);
		}
		if (authorLines.length) {
			sections.push(
				`Contributors the user may be referring to:\n${authorLines.join('\n')}\nWhen the user refers to a person, use author: with a listed contributor's name (or email).`,
			);
		}

		if (!sections.length) return undefined;

		return sections.join('\n\n');
	}

	/**
	 * Fuzzy-matches a failing ref name (from a classified `invalidRef` error) against the repo's local
	 * branches, for the repair prompt to suggest instead of guessing again. Best-effort: any failure
	 * returns undefined.
	 */
	private async buildFuzzyRefCandidates(ref: string): Promise<string | undefined> {
		const repository = this.repository;
		if (repository == null) return undefined;

		try {
			const { values: branches } = await repository.git.branches.getBranches({ filter: b => !b.remote });
			if (!branches.length) return undefined;

			// Containment first: a hallucinated ref is usually a real name with extra words bolted on
			// (e.g. 'please-go-through-the-readme'), which fuzzy subsequence matching can never find
			// because the needle is longer than every real name
			const lower = ref.toLowerCase();
			let names = branches
				.filter(b => lower.includes(b.name.toLowerCase()) || b.name.toLowerCase().includes(lower))
				.map(b => b.name);
			if (!names.length) {
				names = fuzzyFilter(ref, branches, b => b.name).map(m => m.item.name);
			}
			if (!names.length) return undefined;

			return `The ref '${ref}' does not exist. Closest existing refs: ${names.slice(0, 10).join(', ')}.`;
		} catch (ex) {
			Logger.error(ex, 'GraphSearchService', 'buildFuzzyRefCandidates');
			return undefined;
		}
	}

	/**
	 * Fetches contributors for {@link buildSearchRelaxationCandidates}'s author/committer respell candidates.
	 * Bounded to 200ms — same budget as {@link buildRepoSearchContext} — and runs BEFORE the relaxation
	 * probing budget starts, so a cold contributors cache can never stall the zero-result response past a
	 * bounded ceiling; `buildSearchRelaxationCandidates` itself must stay synchronous, so this has to resolve
	 * before it's called.
	 */
	private async buildRelaxationContributors(): Promise<
		Array<{ name: string; email: string | undefined }> | undefined
	> {
		const repository = this.repository;
		if (repository == null) return undefined;

		try {
			return await cancellable<Array<{ name: string; email: string | undefined }> | undefined>(
				repository.git.contributors.getContributorsLite(undefined, { since: '1 year ago' }),
				200,
				undefined,
				{ onDidCancel: resolve => resolve(undefined) },
			);
		} catch (ex) {
			Logger.error(ex, 'GraphSearchService', 'offerSearchRelaxations');
			return undefined;
		}
	}

	/**
	 * Runs one NL/AI round-trip (initial conversion, auto-repair, or manual repair) bridged onto `signal`
	 * (the driving operation's `AbortSignal`) via {@link fromAbortSignal}, so a caller-initiated abort
	 * reaches the live AI call. Defensively composed with a 30s timeout via `AbortSignal.any`, and the
	 * round-trip is RACED against that composed signal — propagating the token cooperatively is not
	 * enough, because a stuck AI call (e.g. blocked model resolution) hangs before it ever subscribes to
	 * the token, leaving the await pending forever. On timeout the result folds into the same
	 * `naturalLanguage.error` shape a normal AI failure would produce, while a caller abort propagates as
	 * a real cancellation for the caller to catch.
	 */
	private async convertNaturalLanguage(
		search: SearchQuery,
		signal: AbortSignal | undefined,
		options?: NaturalLanguageSearchOptions,
	): Promise<SearchQuery> {
		const timeoutMs = this.context.nlConversionTimeoutMs ?? 30000;
		const composed =
			signal != null ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
		const { token, dispose } = fromAbortSignal(composed, this._aiCancellations);

		try {
			const conversion = processNaturalLanguageToSearchQuery(
				this.container,
				search,
				{ source: 'graph' },
				options,
				token,
			);
			// Losing the race abandons the conversion; its eventual settle must not surface as an
			// unhandled rejection.
			conversion.catch(() => {});
			return await raceWithSignal(conversion, composed);
		} catch (ex) {
			// The defensive timeout fired (the caller's own signal, if any, is still live) — fold into a
			// normal AI-failure result instead of stranding the request on a hung call.
			if (isCancellationError(ex) && signal?.aborted !== true) {
				return {
					...search,
					naturalLanguage: { query: search.query, error: 'The AI took too long to respond' },
				};
			}
			throw ex;
		} finally {
			dispose();
		}
	}

	/**
	 * Runs a search, resolving with its final state — or `undefined` when `signal` aborted, which is also
	 * how a newer search supersedes an older one (the caller owns one signal per search, and aborts the
	 * previous one before starting the next). Ships interim states on `onDidChange` as they arrive.
	 */
	async search(params: SearchParams, signal?: AbortSignal): Promise<GraphSearchResponse | undefined> {
		using sw = new Stopwatch(`GraphSearchService.search(${this.host.id})`);

		const operation = new AbortController();
		this._operations.add(operation);
		const onAbort = () => operation.abort();
		if (signal?.aborted) {
			operation.abort();
		} else {
			signal?.addEventListener('abort', onAbort);
		}

		this._searching = true;
		// Any search — new or a `more` resume — ends a pause; background continuations may run again.
		this._paused = false;

		let search: SearchQuery = params.search;
		let exception: (Error & { original?: Error }) | undefined;
		const repair = { attempted: false, succeeded: false };
		let relaxationsOffered: number | undefined;
		let revealSha: string | undefined;
		// Per-call snapshots the telemetry `finally` below reads instead of the live `_current`/`_fallback`
		// — a superseded call's abort/cancellation early-returns skip these writes, so its telemetry
		// reports no results instead of a NEWER search's, which the live fields would have moved on to by
		// the time this call's `finally` runs.
		let currentForTelemetry:
			| { query: SearchQuery; results: GraphSearchResults | GraphSearchResultsError | undefined }
			| undefined;
		let fallbackForTelemetry: { detail?: string } | undefined;

		try {
			if (search.naturalLanguage) {
				try {
					const repoContext = await this.buildRepoSearchContext(search.query);
					search = await this.convertNaturalLanguage(search, operation.signal, { context: repoContext });
				} catch (ex) {
					if (isCancellationError(ex)) return undefined;
					throw ex;
				}

				if (operation.signal.aborted) return undefined;
			}

			const naturalLanguage = typeof search.naturalLanguage === 'object' ? search.naturalLanguage : undefined;

			// The conversion itself failed — `search.query` is still the raw English sentence, which is
			// not a git search pattern and must never be run as one (it dies as an ERE syntax error about
			// text the user never wrote). Answer here, before parsing/telemetry treat this as a git search
			// failure.
			if (naturalLanguage?.error) {
				this.resetSearchTracking();
				this._current = { query: search, results: { error: naturalLanguage.error, reason: 'aiUnavailable' } };
				this._searchStateEvent.fire(this.buildSearchState(false));

				// This exits before the try/finally below that normally sends 'graph/searched' — send it
				// explicitly here so an NL conversion failure isn't silently untelemetered.
				this.host.sendTelemetryEvent('graph/searched', {
					types: 'naturalLanguage',
					duration: sw.elapsed(),
					matches: 0,
					failed: true,
					'failed.reason': 'error',
					'failed.error': naturalLanguage.error,
					'fallback.literal': this._fallback != null,
					'nl.repair.attempted': repair.attempted ? true : undefined,
					'nl.repair.succeeded': repair.succeeded ? true : undefined,
					'nl.relaxations.offered': relaxationsOffered,
					'nl.mode':
						typeof this._current?.query.naturalLanguage === 'object'
							? this._current.query.naturalLanguage.mode
							: undefined,
				});

				return { state: this.buildSearchState(false)! };
			}

			const query = parseSearchQuery(search);
			const types = join(query.operations.keys(), ',');

			try {
				if (naturalLanguage?.processedQuery != null && !params.more) {
					revealSha = await this.searchNaturalLanguageWithRepair(
						{ ...params, search: search },
						naturalLanguage,
						operation.signal,
						repair,
					);

					const results = this._current?.results;
					if (results != null && !isSearchResultsError(results) && results.count === 0) {
						const relaxations = await this.offerSearchRelaxations(search, operation.signal);
						relaxationsOffered = relaxations?.length ?? 0;
					}
				} else {
					revealSha = await this.searchGraphOrContinue({ ...params, search: search }, operation.signal, true);
				}

				if (operation.signal.aborted) return undefined;

				currentForTelemetry = this._current;
				fallbackForTelemetry = this._fallback;

				return { state: this.buildSearchState(false)!, revealSha: revealSha };
			} catch (ex) {
				exception = ex;
				if (isCancellationError(ex)) return undefined;

				this._current = { query: search, results: toGraphSearchResultsError(ex) };
				currentForTelemetry = this._current;
				fallbackForTelemetry = this._fallback;
				this._searchStateEvent.fire(this.buildSearchState(false));
				return { state: this.buildSearchState(false)! };
			} finally {
				const cancelled = isCancellationError(exception);
				const results = currentForTelemetry?.results;

				this.host.sendTelemetryEvent('graph/searched', {
					types: types,
					duration: sw.elapsed(),
					matches: results != null && !isSearchResultsError(results) ? results.count : 0,
					failed: exception != null,
					'failed.reason': exception != null ? (cancelled ? 'cancelled' : 'error') : undefined,
					'failed.error': !cancelled && exception != null ? String(exception) : undefined,
					'failed.error.detail':
						!cancelled && exception?.original != null ? String(exception.original) : undefined,
					'fallback.literal': fallbackForTelemetry != null,
					'nl.repair.attempted': repair.attempted ? true : undefined,
					'nl.repair.succeeded': repair.succeeded ? true : undefined,
					'nl.relaxations.offered': relaxationsOffered,
					'nl.mode':
						typeof currentForTelemetry?.query.naturalLanguage === 'object'
							? currentForTelemetry.query.naturalLanguage.mode
							: undefined,
				});
			}
		} finally {
			this._searching = false;
			signal?.removeEventListener('abort', onAbort);
			this._operations.delete(operation);
		}
	}

	/**
	 * Runs an NL-converted search, repairing it with AI once if git rejects the generated query.
	 *
	 * The first attempt suppresses the literal-pattern fallback: matching literally would silently
	 * "succeed" on a query the AI got wrong instead of surfacing a real git error for repair to work
	 * from. If repair produces a different query, that runs with the fallback enabled. If repair can't
	 * help (unchanged query, itself errors, or still fails), the last resort re-runs the ORIGINAL
	 * generated query with the fallback enabled, so a merely-unlucky regex still gets its normal escape
	 * hatch before NL search gives up. NL searches never surface `invalidPattern` wording — that's
	 * meaningless to a user who never typed a regex. `invalidRef` is the exception: when even repair
	 * can't resolve the AI's ref guess, that failure IS user-language ("No branch or tag named 'x'") and
	 * is worth showing instead of a generic rephrase prompt.
	 */
	private async searchNaturalLanguageWithRepair(
		e: SearchParams,
		naturalLanguage: { query: string; processedQuery?: string; error?: string },
		signal: AbortSignal,
		repair: { attempted: boolean; succeeded: boolean },
	): Promise<string | undefined> {
		try {
			return await this.searchGraphOrContinue(e, signal, true, { suppressFallback: true });
		} catch (ex) {
			if (isCancellationError(ex)) throw ex;
			if (!GitSearchError.is(ex) || ex.reason == null) throw ex;

			repair.attempted = true;

			const repoContext = await this.buildRepoSearchContext(naturalLanguage.query);
			let repairContext = buildRepairContext(e.search.query, toGraphSearchResultsError(ex).error);
			if (ex.reason === 'invalidRef' && ex.detail) {
				const candidates = await this.buildFuzzyRefCandidates(ex.detail);
				if (candidates) {
					repairContext += `\n${candidates}`;
				}
			}

			const repaired = await this.convertNaturalLanguage(
				{ ...e.search, query: naturalLanguage.query, naturalLanguage: { query: naturalLanguage.query } },
				signal,
				{ context: repoContext ? `${repoContext}\n\n${repairContext}` : repairContext },
			);

			if (signal.aborted) return undefined;

			const repairedNaturalLanguage =
				typeof repaired.naturalLanguage === 'object' ? repaired.naturalLanguage : undefined;

			if (repairedNaturalLanguage?.error == null && repaired.query !== e.search.query) {
				try {
					const revealSha = await this.searchGraphOrContinue({ ...e, search: repaired }, signal, true);
					repair.succeeded = true;
					return revealSha;
				} catch (retryEx) {
					if (isCancellationError(retryEx)) throw retryEx;
					// Repaired query also failed — fall through to the last resort below.
				}
			}

			try {
				return await this.searchGraphOrContinue(e, signal, true);
			} catch (lastEx) {
				if (isCancellationError(lastEx)) throw lastEx;

				if (GitSearchError.is(lastEx) && lastEx.reason === 'invalidRef') throw lastEx;

				this._search = undefined;
				this._current = {
					query: e.search,
					results: { error: "Couldn't complete this search — try rephrasing" },
				};
				this._searchStateEvent.fire(this.buildSearchState(false));
				return undefined;
			}
		}
	}

	/**
	 * Counts every candidate concurrently (each honoring `cancellation`) and returns only the ones that
	 * found something (count > 0). Never throws — a provider without `countSearchResults` (e.g. GitHub)
	 * degrades to "no relaxations" via the optional-chained call returning nothing to await.
	 */
	private async probeSearchRelaxations(
		baseSearch: SearchQuery,
		candidates: SearchRelaxationCandidate[],
		cancellation: AbortSignal | undefined,
	): Promise<GraphSearchRelaxation[]> {
		const graph = this.repository?.git.graph;
		if (graph?.countSearchResults == null) return [];

		const maxCount = 1000;
		const settled = await Promise.allSettled(
			candidates.map(async candidate => {
				const count = await graph.countSearchResults!(
					{ ...baseSearch, naturalLanguage: undefined, query: candidate.query },
					{ maxCount: maxCount },
					cancellation,
				);
				return {
					label: candidate.label,
					query: candidate.query,
					count: count,
					capped: count >= maxCount || undefined,
				};
			}),
		);

		return getSettledValues(settled).filter(r => r.count > 0);
	}

	/**
	 * Builds and counts relaxation candidates for a just-settled, final, zero-result NL search, budgeted to
	 * ~2s via a composed `AbortSignal.any([signal, AbortSignal.timeout(2000)])` so a slow repo never stalls
	 * the response for long. Fires a follow-up `onDidChange` for the SAME settled search (the terminal state
	 * already fired once before this had a chance to compute anything) and returns the survivors so the
	 * caller can also fold them into telemetry. Abort-guarded: if `signal` aborts while probing, this
	 * returns `undefined` and touches nothing.
	 */
	private async offerSearchRelaxations(
		search: SearchQuery,
		signal: AbortSignal,
	): Promise<GraphSearchRelaxation[] | undefined> {
		if (this.repository == null) return undefined;

		const parsed = parseSearchQuery(search);
		const naturalLanguage = typeof search.naturalLanguage === 'object' ? search.naturalLanguage : undefined;
		const contributors = await this.buildRelaxationContributors();
		const candidates = buildSearchRelaxationCandidates(parsed, naturalLanguage?.alternates, contributors);
		if (!candidates.length) {
			if (signal.aborted) return undefined; // superseded/aborted while gathering candidates

			this._relaxations = undefined;
			return undefined;
		}

		// The internally-tracked query (not the "public" one `publicSearchQuery` may have masked
		// `matchRegex` on for a literal-fallback search) — probing must count what actually ran.
		const baseSearch = this._search?.query ?? search;

		const probeSignal = AbortSignal.any([signal, AbortSignal.timeout(2000)]);
		const survivors = await this.probeSearchRelaxations(baseSearch, candidates, probeSignal);

		if (signal.aborted) return undefined; // superseded/aborted while probing

		this._relaxations = survivors.length ? survivors : undefined;
		if (!survivors.length) return undefined;

		this._searchStateEvent.fire(this.buildSearchState(false));

		return survivors;
	}

	/** Runs a new search or continues (`e.more`) the active one, resolving with the sha to reveal (or
	 *  `undefined` when there's nothing to reveal, or `signal` is aborted). Throws a genuine (non-abort)
	 *  failure so the caller decides how to surface it. */
	private async searchGraphOrContinue(
		e: SearchParams,
		signal: AbortSignal,
		progressive: boolean = true,
		options?: { suppressFallback?: boolean },
	): Promise<string | undefined> {
		// `type:wip` rows are synthetic webview-only rows that never appear in `git log`,
		// so they're enumerated host-side instead of going through the regular search path.
		const wip = await this.tryHandleWipSearch(e, signal);
		if (wip != null) return wip.revealSha;

		let search = this._search;

		const graph = this.context.getSession()!.current;

		if (
			e.more &&
			search?.paging?.cursor != null &&
			search.comparisonKey === getSearchQueryComparisonKey(e.search)
		) {
			if (this.repository == null) {
				this.showNoRepositoryError(e.search);
				return undefined;
			}

			// Continue search from cursor, passing existing results
			const searchStream = this.repository.git.graph.continueSearchGraph(
				search.paging.cursor,
				search.results,
				{ limit: e.limit ?? configuration.get('graph.searchItemLimit') ?? 0 },
				signal,
			);
			using _streamDisposer = createDisposable(() => void searchStream.return?.(undefined!));

			({ search } = await this.processSearchStream(searchStream, signal, progressive, graph, {
				seed: search,
			}));

			if (signal.aborted) return undefined;

			if (search != null) {
				this._search = updateSearchMode(this.container, search);
				this.syncCurrent();
			}

			return undefined;
		}

		if (e.more && search?.comparisonKey !== getSearchQueryComparisonKey(e.search)) {
			// A continuation whose live search no longer matches the requested query (superseded or
			// cleared) must never fall through into starting a brand-new search for the abandoned query.
			return undefined;
		}

		let firstResultSelected = false;
		/** The sha this search revealed, carried on the response so the app can scroll to it. */
		let revealSha: string | undefined;

		if (search?.comparisonKey !== getSearchQueryComparisonKey(e.search)) {
			if (this.repository == null) {
				this.showNoRepositoryError(e.search);
				return undefined;
			}

			if (this.repository.etag !== this.context.getEtagRepository()) {
				this.context.updateState(true);
			}

			this.resetSearchTracking();
			this._current = { query: e.search, results: undefined };
			if (progressive) {
				this._searchStateEvent.fire(this.buildSearchState(true));
			}

			const searchStream = this.repository.git.graph.searchGraph(
				e.search,
				{
					limit: configuration.get('graph.searchItemLimit') ?? 0,
					ordering: configuration.get('graph.commitOrdering'),
				},
				signal,
			);
			using _streamDisposer = createDisposable(() => void searchStream.return?.(undefined!));

			try {
				({ search, firstResultSelected, revealSha } = await this.processSearchStream(
					searchStream,
					signal,
					progressive,
					graph,
					{ selectFirstResult: true },
				));

				if (search == null) {
					if (signal.aborted) return undefined;
					throw new Error('Search generator completed without returning a result');
				}
			} catch (ex) {
				if (signal.aborted) return undefined;

				// A pattern that doesn't (yet) compile as regex is normal mid-keystroke (e.g. `fix(`) — retry
				// once as a literal search instead of flashing an error while the user is still typing it out.
				// Suppressed for NL-repair's first attempt so a classified error reaches the caller instead.
				if (
					!options?.suppressFallback &&
					GitSearchError.is(ex) &&
					ex.reason === 'invalidPattern' &&
					e.search.matchRegex !== false
				) {
					this._fallback = { detail: ex.detail };

					try {
						const fallbackStream = this.repository.git.graph.searchGraph(
							{ ...e.search, matchRegex: false },
							{
								limit: configuration.get('graph.searchItemLimit') ?? 0,
								ordering: configuration.get('graph.commitOrdering'),
							},
							signal,
						);
						using _fallbackStreamDisposer = createDisposable(
							() => void fallbackStream.return?.(undefined!),
						);

						({ search, firstResultSelected, revealSha } = await this.processSearchStream(
							fallbackStream,
							signal,
							progressive,
							graph,
							{ selectFirstResult: true },
						));

						if (search == null) {
							if (signal.aborted) return undefined;
							throw new Error('Fallback search generator completed without returning a result', {
								cause: ex,
							});
						}

						// The provider computed `comparisonKey` from the executed (literal) query — patch it
						// back to the original so a later `e.more` continuation (which always sends the
						// original query) still matches and continues from the literal cursor.
						search = { ...search, comparisonKey: getSearchQueryComparisonKey(e.search) };
					} catch {
						if (signal.aborted) return undefined;

						this._fallback = undefined;
						this._search = undefined;
						throw ex; // surface the original classified error, not the fallback attempt's
					}
				} else {
					this._search = undefined;
					throw ex;
				}
			}

			if (!signal.aborted) {
				this._search = updateSearchMode(this.container, search);
				this.syncCurrent();
			}
		} else {
			search = this._search!;

			// Select first result if not already selected (for cached searches)
			if (!firstResultSelected) {
				const firstResult = await this.ensureSearchStartsInRange(graph, search.results);
				if (firstResult != null) {
					this.context.setSelectedRows(firstResult);
					firstResultSelected = true;
					revealSha = firstResult;
					this.context.notifyDidChangeRows(true);
				}
			}

			// Send an update with cached results (only when not resuming — resuming lets the progressive
			// notifications inside `processSearchStream` handle it)
			if (progressive && !e.more) {
				// Refresh `_current` from `_search` to include any mode change (filter toggle) that
				// happened during the search.
				this.syncCurrent();
				this._searchStateEvent.fire(this.buildSearchState(false));
			}
		}

		return revealSha;
	}

	/** Silently continues the ACTIVE search in the background (an auto-load-more keeping pace with a rows
	 *  page-in) — no per-batch progress noise, only the settled state. Rethrows a genuine (non-abort)
	 *  failure so the caller decides how to surface it. Resolves to whether the search's accumulated
	 *  results or `hasMore` actually changed, so a caller can skip re-publishing state that's identical to
	 *  what it already has (a stale/superseded continuation that bails without touching `_search` reports
	 *  no change). */
	async continueInBackground(query: SearchQuery): Promise<boolean> {
		// A paused search must stay paused: this can be called AFTER the pause (a rows page-in still in
		// flight from before it), and running would walk the rest of the history and publish the full
		// tally over the state the user froze.
		if (this._paused) return false;

		const operation = new AbortController();
		this._operations.add(operation);
		const beforeSize = this._search?.results.size;
		const beforeHasMore = this._search?.hasMore;
		try {
			await this.searchGraphOrContinue({ search: query, more: true }, operation.signal, false);
			return this._search?.results.size !== beforeSize || this._search?.hasMore !== beforeHasMore;
		} finally {
			this._operations.delete(operation);
		}
	}

	/** Fires the current settled state — for a caller (the data controller's background continuation) that
	 *  updated `_search` through a non-progressive path and now needs the app to hear about it. */
	publishState(): void {
		this._searchStateEvent.fire(this.buildSearchState(false));
	}

	/** Shows a search failure that happened outside `search()`'s own call (the data controller's background
	 *  continuation) as the current state — unless the failing query has already been superseded by a
	 *  newer search by the time this lands (the continuation runs concurrently with, and isn't aborted by,
	 *  a later foreground search), in which case it's bailed instead of misattributing the error to
	 *  whatever the user has since moved on to. */
	notifySearchError(query: SearchQuery, results: GraphSearchResultsError): void {
		const liveComparisonKey =
			this._search?.comparisonKey ??
			(this._current != null ? getSearchQueryComparisonKey(this._current.query) : undefined);
		if (liveComparisonKey !== getSearchQueryComparisonKey(query)) return;

		this._current = { query: query, results: results };
		this._searchStateEvent.fire(this.buildSearchState(false));
	}

	private async tryHandleWipSearch(
		e: SearchParams,
		signal: AbortSignal,
	): Promise<{ revealSha: string | undefined } | undefined> {
		if (!e.search?.query) return undefined;

		const parsed = parseSearchQueryGitCommand(e.search, undefined);
		if (parsed.filters.type !== 'wip') return undefined;

		if (this.repository == null) {
			this.showNoRepositoryError(e.search);
			return { revealSha: undefined };
		}

		const comparisonKey = getSearchQueryComparisonKey(e.search);

		// Same wip query as the cached one (covers `e.more` too) — re-emit the cached results.
		if (this._search?.comparisonKey === comparisonKey) {
			this.syncCurrent();
			return { revealSha: undefined };
		}

		this.resetSearchTracking();
		this._current = { query: e.search, results: undefined };
		this._searchStateEvent.fire(this.buildSearchState(true));

		// Use the same enumeration that feeds the rendered WIP rows so search and rendering agree.
		const wipRowsById = await this.context.getWipRows();

		if (signal.aborted) return { revealSha: undefined };

		const results: GitGraphSearchResults = new Map();
		const now = Date.now();
		let i = 0;
		const primaryWipRowId = createWipRowId(this.repository.path);
		// `now` is the primary row's REAL position, not a fallback: the graph places work-dir changes at
		// the start of the timeline rather than against a commit, so anything time-positioned should
		// put it at the newest edge. The graph's own worktree leads, then its peers — it's also an entry
		// in `wipRowsById`, so skip it there rather than re-`set` it (which would move it to the end of
		// the result ordering).
		results.set(primaryWipRowId, { i: i++, date: now });
		for (const [sha, wipRow] of Object.entries(wipRowsById)) {
			if (sha === primaryWipRowId) continue;

			// Secondary WIP rows ARE anchored to a commit (their worktree HEAD), so date them there —
			// the minimap already places its worktree markers by `parentSha`, and dating these at "now"
			// instead stacked every worktree onto today. `now` here is only a last resort for a worktree
			// whose HEAD date didn't come through.
			results.set(sha, { i: i++, date: wipRow.parentDate ?? now });
		}

		const search: GitGraphSearch = {
			repoPath: this.repository.path,
			query: e.search,
			queryFilters: parsed.filters,
			comparisonKey: comparisonKey,
			hasMore: false,
			results: results,
		};
		this._search = updateSearchMode(this.container, search);
		this.syncCurrent();

		this.context.setSelectedRows(primaryWipRowId);
		this.context.notifyDidChangeRows(true);

		this._searchStateEvent.fire(this.buildSearchState(false));

		return { revealSha: primaryWipRowId };
	}

	private async processSearchStream(
		searchStream: AsyncGenerator<GitGraphSearchProgress, GitGraphSearch, void>,
		signal: AbortSignal,
		progressive: boolean,
		graph: GitGraph,
		options?: { selectFirstResult?: boolean; seed?: GitGraphSearch },
	): Promise<{ search: GitGraphSearch | undefined; firstResultSelected: boolean; revealSha: string | undefined }> {
		// A continuation seeds accumulation with the results it continues FROM — otherwise its first
		// batch replaces the shown totals with just its own few rows (a resume visibly dropping from the
		// paused count to ~1 before climbing back) until the final value restores the full set.
		let search: GitGraphSearch | undefined = options?.seed;
		let firstResultSelected = false;
		let revealSha: string | undefined;

		/** The last `_search` this stream wrote, so an abort can tell "still ours" from "a newer search
		 *  already claimed it" by identity alone. */
		let ourLastWrite: GitGraphSearch | undefined;

		let result: IteratorResult<GitGraphSearchProgress, GitGraphSearch> | undefined;
		while (!(result = await searchStream.next()).done) {
			const progress = result.value;
			if (!progress.results.size) continue;

			// Accumulate results from progressive batches
			if (search?.results != null) {
				for (const [sha, data] of progress.results) {
					search.results.set(sha, data);
				}

				search = {
					repoPath: search.repoPath,
					query: search.query,
					queryFilters: search.queryFilters,
					comparisonKey: search.comparisonKey,
					results: search.results,
					hasMore: progress.hasMore,
				};
			} else {
				search = {
					repoPath: progress.repoPath,
					query: progress.query,
					queryFilters: progress.queryFilters,
					comparisonKey: progress.comparisonKey,
					results: new Map(progress.results),
					hasMore: progress.hasMore,
				};
			}
			// Side effects stop the moment the caller aborts, but the loop keeps draining: the provider
			// answers a cancelled stream with a final value carrying the resumable cursor, and breaking
			// out here would throw that away — a paused search could then never continue, only restart.
			if (signal.aborted) continue;

			this._search = updateSearchMode(this.container, search);
			ourLastWrite = this._search;
			this.syncCurrent();

			// Select first result as soon as we find one (only once). Re-check abort after the await —
			// `setSelectedRows` is a blind write that would stomp a newer search.
			if (options?.selectFirstResult && !firstResultSelected) {
				const firstResult = await this.ensureSearchStartsInRange(graph, progress.results);
				if (firstResult != null && !signal.aborted) {
					this.context.setSelectedRows(firstResult);
					firstResultSelected = true;
					revealSha = firstResult;
					this.context.notifyDidChangeRows(true);
				}
			}

			if (progressive) {
				// The accumulated results so far — `onDidChange` is `save-last`, so a delta here would
				// silently lose whatever batch a hidden webview's buffer drops.
				this._searchStateEvent.fire(this.buildSearchState(true));
			}
		}

		// Get final result from generator
		if (result?.value != null) {
			search = result.value;
			// A cancelled stream still answers with the cursor to resume from, so an abort must keep that
			// value — a pause that dropped it could only restart. What an abort must NOT do is write over
			// a newer search that already claimed `_search`, which identity settles without any id.
			// (One provider path — sha resolution — returns no cursor when cancelled; a `commit:` search
			// paused there restarts, exactly as it did before.)
			if (!signal.aborted || this._search === ourLastWrite) {
				this._search = updateSearchMode(this.container, search);
				this.syncCurrent();
			}
			// Nothing below is state the caller keeps — an aborted operation reveals nothing and emits
			// nothing, so its results reach no one until a `more` picks them up from the cursor above.
			if (signal.aborted) {
				return { search: search, firstResultSelected: firstResultSelected, revealSha: revealSha };
			}

			// Last chance to select: a per-batch attempt above misses whenever a concurrent paging walk
			// supersedes its page-in, and without a selection here nothing ever reveals the match. Re-check
			// abort after the await — `setSelectedRows` is a blind write that would stomp a newer search.
			const firstResult = await this.ensureSearchStartsInRange(graph, search.results);
			if (options?.selectFirstResult && !firstResultSelected && firstResult != null && !signal.aborted) {
				this.context.setSelectedRows(firstResult);
				firstResultSelected = true;
				revealSha = firstResult;
				this.context.notifyDidChangeRows(true);
			}

			// Send the final, complete state
			if (progressive) {
				this._searchStateEvent.fire(this.buildSearchState(false));
			}
		}

		return { search: search, firstResultSelected: firstResultSelected, revealSha: revealSha };
	}

	openInView(search: SearchQuery): void {
		if (this.repository == null) return;

		void this.container.views.searchAndCompare.search(this.repository.path, search, {
			label: { label: `for ${search.query}` },
			reveal: { select: true, focus: false, expand: true },
		});
	}

	/** Asks AI to repair a hand-written search query git refused to compile. */
	async repair(query: string, detail?: string): Promise<DidSearchRepairParams> {
		const operation = new AbortController();
		this._operations.add(operation);
		try {
			const converted = await this.convertNaturalLanguage(
				{ query: query, naturalLanguage: { query: query } },
				operation.signal,
				{ context: buildRepairContext(query, detail) },
			);

			const naturalLanguage =
				typeof converted.naturalLanguage === 'object' ? converted.naturalLanguage : undefined;
			if (naturalLanguage?.error != null) {
				return { query: undefined, error: naturalLanguage.error };
			}

			return { query: converted.query };
		} catch (ex) {
			if (isCancellationError(ex)) return { query: undefined };

			return { query: undefined, error: ex instanceof Error ? ex.message : String(ex) };
		} finally {
			this._operations.delete(operation);
		}
	}

	private getSearchResultsData(
		search: GitGraphSearch | GitGraphSearchProgress | undefined,
	): GraphSearchResults | undefined {
		if (!search?.results?.size) return undefined;

		return {
			ids: Object.fromEntries(search.results),
			count: search.results.size,
			hasMore: search.hasMore,
		};
	}

	private async ensureSearchStartsInRange(
		graph: GitGraph,
		results: GitGraphSearchResults,
	): Promise<string | undefined> {
		if (!results.size) return undefined;

		// If we have a selection and it is in the search results, keep it
		const selectedId = this.context.getSelectedId();
		if (selectedId != null && results.has(selectedId)) {
			if (graph.ids.has(selectedId)) {
				return selectedId;
			}
		}

		// Find the first result that is in the graph
		let firstResult: string | undefined;
		for (const id of results.keys()) {
			if (graph.ids.has(id)) return id;

			firstResult = id;
			break;
		}

		if (firstResult == null) return undefined;

		// `limit: 0` for an UNCAPPED targeted walk, matching the other two targeted page-ins (`revealRow`,
		// `ensureSelectedTargetLoaded`). The default page size caps a walk at `pageItemLimit*10`, which
		// stops at the frontier instead of the match, leaving a deeper hit unloaded and so unselectable —
		// the search finds it and then never jumps to it. The walk stops as soon as it reaches the sha.
		await this.context.updateGraphWithMoreRows(firstResult, 0);
		this.context.notifyDidChangeRows();

		// Re-read the live graph — a concurrent session refresh during the page-load await above
		// can swap the session's graph out from under the `graph` captured before the await.
		const currentGraph = this.context.getSession()?.current;
		return currentGraph?.ids.has(firstResult) ? firstResult : undefined;
	}

	getSearchContext(id: string | undefined): GitCommitSearchContext | undefined {
		if (!this._search?.queryFilters.files || id == null) return undefined;

		const result = this._search.results.get(id);
		return {
			query: this._search.query,
			queryFilters: this._search.queryFilters,
			matchedFiles: result?.files ?? [],
			hiddenFromGraph: this.context.getSelectedRows()?.[id]?.hidden ?? false,
		};
	}

	setMode(searchMode: GraphSearchMode | undefined, useNaturalLanguage: boolean): void {
		void this.container.storage.store('graph:useNaturalLanguageSearch', useNaturalLanguage).catch();
		// No mode chosen (an NL toggle) — leave the sticky mode AND the active search's filter alone,
		// so a live NL-forced filter isn't stamped as the preference or un-forced mid-search.
		if (searchMode == null) return;

		void this.container.storage.store('graph:searchMode', searchMode).catch();

		// Update the active search query's filter property to match the new mode
		updateSearchMode(this.container, this._search, searchMode);
		this.syncCurrent();
	}

	/** An external request to run a search in the graph (deep link, command, another surface). */
	requestSearch(params: DidRequestSearchParams): void {
		this._requestSearchEvent.fire(params);
	}

	getState(): Promise<GraphSearchState | undefined> {
		return Promise.resolve(this.buildSearchState(this._searching));
	}
}

function updateSearchMode<T extends GitGraphSearch | undefined>(
	container: Container,
	search: T,
	mode?: GraphSearchMode,
): T {
	if (search?.query != null) {
		// A natural-language search that resolved to `mode: 'filter'` forces filter mode for THIS
		// search — it's deliberate AI-read intent ("only show..."), not the sticky preference an
		// explicit toggle click sets, so it wins here but is never persisted to `graph:searchMode`.
		if (
			mode == null &&
			typeof search.query.naturalLanguage === 'object' &&
			search.query.naturalLanguage.mode === 'filter'
		) {
			mode = 'filter';
		}

		mode ??= container.storage.get('graph:searchMode', 'normal');
		search.query.filter = mode === 'filter';
	}
	return search;
}
