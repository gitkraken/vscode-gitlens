import { CancellationTokenSource } from 'vscode';
import { GitSearchError } from '@gitlens/git/errors.js';
import type { GitGraph } from '@gitlens/git/models/graph.js';
import type { GitGraphSearch, GitGraphSearchProgress, GitGraphSearchResults } from '@gitlens/git/models/graphSearch.js';
import type { GitGraphSession } from '@gitlens/git/models/graphSession.js';
import type { GitCommitSearchContext, SearchQuery } from '@gitlens/git/models/search.js';
import {
	getSearchQueryComparisonKey,
	parseSearchQuery,
	parseSearchQueryGitCommand,
} from '@gitlens/git/utils/search.utils.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { getScopedCounter } from '@gitlens/utils/counter.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import { join } from '@gitlens/utils/iterable.js';
import { Logger } from '@gitlens/utils/logger.js';
import { cancellable } from '@gitlens/utils/promise.js';
import { Stopwatch } from '@gitlens/utils/stopwatch.js';
import type { Container } from '../../../container.js';
import type { GlRepository } from '../../../git/models/repository.js';
import { processNaturalLanguageToSearchQuery } from '../../../git/search.naturalLanguage.js';
import type { NaturalLanguageSearchOptions } from '../../../plus/search/naturalLanguageSearchProcessor.js';
import { toAbortSignal } from '../../../system/-webview/cancellation.js';
import { configuration } from '../../../system/-webview/configuration.js';
import type { IpcParams, IpcResponse } from '../../ipc/handlerRegistry.js';
import type { WebviewHost } from '../../webviewProvider.js';
import type { SelectedRowState } from './graphWebview.js';
import { createWipRowId, DidSearchNotification } from './protocol.js';
import type {
	DidSearchParams,
	GraphSearchMode,
	GraphSearchResults,
	GraphSearchResultsError,
	GraphSelectedRows,
	GraphSelection,
	GraphWipRowsById,
	SearchHistoryDeleteRequest,
	SearchHistoryGetRequest,
	SearchHistoryStoreRequest,
	SearchOpenInViewCommand,
	SearchRepairRequest,
	SearchRequest,
	UpdateGraphSearchModeCommand,
} from './protocol.js';
import { SearchHistory } from './searchHistory.js';

/** Collaborators the search cluster reaches for on the host provider, assembled by
 *  `GraphWebviewProvider.createGraphSearchContext()`. `getRepository`/`getSession` read live provider
 *  state; the selection/etag reads and `setSelectedRows` route through the provider's selection state
 *  (kept there); `updateState`/`updateGraphWithMoreRows`/`notifyDidChangeRows` forward into the data
 *  controller; `getWipRows` forwards into the WIP service; the search cancellation callbacks
 *  route through the provider's shared `_cancellations` map, which stays there. */
export type GraphSearchServiceContext = {
	container: Container;
	host: WebviewHost<'gitlens.views.graph' | 'gitlens.graph'>;
	getRepository: () => GlRepository | undefined;
	getSession: () => GitGraphSession | undefined;
	getSelectedId: () => string | undefined;
	getSelectedRows: () => Record<string, SelectedRowState> | undefined;
	getConvertedSelectedRows: () => GraphSelectedRows;
	getEtagRepository: () => number | undefined;
	setSelectedRows: (id: string | undefined, selection?: GraphSelection[], state?: SelectedRowState) => void;
	updateState: (immediate?: boolean) => void;
	updateGraphWithMoreRows: (id: string, limitOverride?: number) => Promise<void>;
	notifyDidChangeRows: () => void;
	getWipRows: () => Promise<GraphWipRowsById>;
	createSearchCancellation: () => CancellationTokenSource;
	cancelSearchOperation: () => void;
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

/** AI repair context: the query that failed to compile and git's complaint about it. Shared by the
 *  NL-search auto-repair path and the manual repair request, so both ask for the same thing — worded
 *  for either origin, since the manual path's query is the user's own and often has no git detail. */
function buildRepairContext(query: string, error: string | undefined): string {
	return `The previous search query \`${query}\` failed to compile.${
		error ? `\nGit reported: ${error}` : ''
	}\nReturn a corrected search query that preserves the original intent.`;
}

/** Host-side search cluster for the graph, split out of `GraphWebviewProvider` (R3). Owns the active
 *  graph search (`_search`), the supersede counter (`_searchIdCounter`), and the per-repo search
 *  history (`_searchHistory`), along with the search-execution logic (new/continue/WIP streams,
 *  progressive supersede guards), the search-results serialization, the rows-plane search rider, and
 *  the mode/history/open-in-view handlers. The provider keeps the IPC forwarders and injects the
 *  collaborators via {@link GraphSearchServiceContext}. */
export class GraphSearchService {
	private _search: GitGraphSearch | undefined;
	private _searchIdCounter = getScopedCounter();
	private _searchHistory: SearchHistory | undefined;

	/**
	 * Set for the lifetime of a search (through its `e.more` continuations) that recovered from an
	 * invalid-regex pattern by matching literally instead — a pattern mid-keystroke (e.g. `fix(`) fails
	 * to compile constantly, and flashing an error on every one is worse than quietly matching literally
	 * until the pattern completes. Cleared the moment a genuinely new search starts.
	 */
	private _fallback: { detail?: string } | undefined;

	/**
	 * Cancellation for whichever NL/AI round-trip is currently in flight (initial conversion, the
	 * auto-repair round, or a manual "Fix with AI" repair) — held here (not in the shared
	 * `_cancellations` map, which is for git-operation cancellation) so a user-initiated cancel
	 * (search-cancel / reset) can always reach the AI call, and so a defensive timeout can abort it.
	 * Replaced (cancel+dispose the old one) at the start of each new round-trip; disposed when that
	 * round-trip completes.
	 */
	private _nlCancellation: CancellationTokenSource | undefined;

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
	 *  and the rows-plane rider. */
	get search(): GitGraphSearch | undefined {
		return this._search;
	}

	/** Current supersede-counter value. Read by the data controller to stamp stale-search responses. */
	get searchIdCounterCurrent(): number {
		return this._searchIdCounter.current;
	}

	/** {@link _fallback} as the wire payload, or `undefined` when no fallback is active for the current search. */
	private buildFallbackParam(): DidSearchParams['fallback'] {
		return this._fallback != null ? { matchedAs: 'literal', detail: this._fallback.detail } : undefined;
	}

	/** `query` with `matchRegex` forced back to `true` while {@link _fallback} is active — the query stored
	 *  on `_search` stays the executed (literal) one (paging cursors and `comparisonKey` need it), but
	 *  nothing webview-facing may show the regex toggle as off. */
	private publicSearchQuery(query: SearchQuery): SearchQuery {
		return this._fallback != null ? { ...query, matchRegex: true } : query;
	}

	onSearchHistoryGetRequest(): IpcResponse<typeof SearchHistoryGetRequest> {
		this._searchHistory ??= new SearchHistory(this.container.storage, this.repository?.path);
		try {
			return { history: this._searchHistory.get() };
		} catch {
			return { history: [] };
		}
	}

	async onSearchHistoryStoreRequest(
		params: IpcParams<typeof SearchHistoryStoreRequest>,
	): Promise<IpcResponse<typeof SearchHistoryStoreRequest>> {
		this._searchHistory ??= new SearchHistory(this.container.storage, this.repository?.path);

		try {
			await this._searchHistory.store(params.search);
			return { history: this._searchHistory.get() };
		} catch (ex) {
			Logger.error(ex, 'GraphWebviewProvider', 'onSearchHistoryStoreRequest');
			// Surface storage errors to the frontend instead of swallowing in `finally` and pretending
			// success — the user thought the entry was saved; on reload it would be missing.
			return { history: this._searchHistory.get(), error: ex instanceof Error ? ex.message : String(ex) };
		}
	}

	async onSearchHistoryDeleteRequest(
		params: IpcParams<typeof SearchHistoryDeleteRequest>,
	): Promise<IpcResponse<typeof SearchHistoryDeleteRequest>> {
		this._searchHistory ??= new SearchHistory(this.container.storage, this.repository?.path);
		try {
			await this._searchHistory.delete(params.query);
			return { history: this._searchHistory.get() };
		} catch (ex) {
			Logger.error(ex, 'GraphWebviewProvider', 'onSearchHistoryDeleteRequest');
			return { history: this._searchHistory.get(), error: ex instanceof Error ? ex.message : String(ex) };
		}
	}

	onSearchCancel(params: { preserveResults: boolean }): void {
		this._nlCancellation?.cancel();
		this._nlCancellation?.dispose();
		this._nlCancellation = undefined;

		// For pause (preserveResults: true), the generator will handle cancellation gracefully and return
		// results collected so far — keep the accumulated state and just stop the git op.
		if (params.preserveResults) {
			this.context.cancelSearchOperation();
			return;
		}

		this.resetSearchState();
	}

	/**
	 * Runs one NL/AI round-trip (initial conversion, auto-repair, or manual repair) against a fresh
	 * cancellation source held on {@link _nlCancellation} — replacing (cancel+dispose) whichever
	 * round-trip was still in flight, so cancel/reset always reaches the live AI call. Defensively
	 * timed out at 30s so a stuck AI call (e.g. blocked model resolution) can't strand the request
	 * forever; on timeout the token is cancelled too and the result folds into the same
	 * `naturalLanguage.error` shape a normal AI failure would produce.
	 */
	private async convertNaturalLanguage(
		search: SearchQuery,
		options?: NaturalLanguageSearchOptions,
	): Promise<SearchQuery> {
		this._nlCancellation?.cancel();
		this._nlCancellation?.dispose();
		const cancellation = (this._nlCancellation = new CancellationTokenSource());

		try {
			return await cancellable(
				processNaturalLanguageToSearchQuery(
					this.container,
					search,
					{ source: 'graph' },
					options,
					cancellation.token,
				),
				30000,
				undefined,
				{
					onDidCancel: resolve => {
						cancellation.cancel();
						resolve({
							...search,
							naturalLanguage: { query: search.query, error: 'The AI took too long to respond' },
						});
					},
				},
			);
		} finally {
			if (this._nlCancellation === cancellation) {
				this._nlCancellation.dispose();
				this._nlCancellation = undefined;
			}
		}
	}

	async onSearchRequest(params: IpcParams<typeof SearchRequest>): Promise<IpcResponse<typeof SearchRequest>> {
		using sw = new Stopwatch(`GraphWebviewProvider.onSearchRequest(${this.host.id})`);

		if (params.search?.naturalLanguage) {
			// Capture the supersede token first: the AI round-trip below is long enough for the user to
			// clear the box or retype, and both bump the counter. Without the check afterwards the
			// converted query still runs and its `DidSearchNotification` repopulates the search box the
			// user just cleared (e.g. "changes" reappearing as `type:wip` a second later).
			const requestedSearchId = this._searchIdCounter.current;

			try {
				params.search = await this.convertNaturalLanguage(params.search);
			} catch (ex) {
				if (!isCancellationError(ex)) throw ex;

				// User-initiated cancel (cleared/retyped the box, or reset) landed mid-conversion — answer
				// with the stale id so the webview's `searchId === currentSearchId` guard drops this
				// response instead of surfacing an error for something the user already dismissed.
				return { search: undefined, results: undefined, partial: false, searchId: requestedSearchId };
			}

			if (this._searchIdCounter.current !== requestedSearchId) {
				// Answer with the stale id so the webview's `searchId === currentSearchId` guard drops
				// this response instead of clobbering whatever superseded it.
				return { search: undefined, results: undefined, partial: false, searchId: requestedSearchId };
			}
		}

		const naturalLanguage =
			typeof params.search?.naturalLanguage === 'object' ? params.search.naturalLanguage : undefined;

		// The conversion itself failed — `params.search.query` is still the raw English sentence, which is
		// not a git search pattern and must never be run as one (it dies as an ERE syntax error about text
		// the user never wrote). Answer here, before parsing/telemetry treat this as a git search failure.
		if (naturalLanguage?.error) {
			const searchId = this._searchIdCounter.next();
			this._search = undefined;
			this._fallback = undefined;

			// Carry the same error results the response below carries — the response can get dropped by
			// the app's searchId guard (see the supersede checks above), and the notification is what
			// actually raises `searching` for a NEW search id, so it must be able to lower it right back
			// down on its own instead of leaving the spinner stranded.
			const results: GraphSearchResultsError = { error: naturalLanguage.error, reason: 'aiUnavailable' };

			void this.host.notify(DidSearchNotification, {
				search: params.search,
				results: results,
				partial: false,
				searchId: searchId,
			});

			return {
				search: params.search,
				results: results,
				partial: false,
				searchId: searchId,
			};
		}

		const query = params.search ? parseSearchQuery(params.search) : undefined;
		const types = query != null ? join(query.operations.keys(), ',') : '';

		let results: IpcResponse<typeof SearchRequest> | undefined;
		let exception: (Error & { original?: Error }) | undefined;
		const repair = { attempted: false, succeeded: false };

		try {
			if (naturalLanguage?.processedQuery != null && !params.more) {
				results = await this.searchNaturalLanguageWithRepair(params, naturalLanguage, repair);
			} else {
				results = await this.searchGraphOrContinue(params, true);
			}
			return results;
		} catch (ex) {
			exception = ex;
			return {
				search: params.search,
				results: isCancellationError(ex) ? undefined : toGraphSearchResultsError(ex),
				partial: false,
				searchId: this._searchIdCounter.current,
			};
		} finally {
			const cancelled = isCancellationError(exception);

			this.host.sendTelemetryEvent('graph/searched', {
				types: types,
				duration: sw.elapsed(),
				matches: (results?.results as GraphSearchResults)?.count ?? 0,
				failed: exception != null,
				'failed.reason': exception != null ? (cancelled ? 'cancelled' : 'error') : undefined,
				'failed.error': !cancelled && exception != null ? String(exception) : undefined,
				'failed.error.detail':
					!cancelled && exception?.original != null ? String(exception?.original) : undefined,
				'fallback.literal': this._fallback != null,
				'nl.repair.attempted': repair.attempted ? true : undefined,
				'nl.repair.succeeded': repair.succeeded ? true : undefined,
			});
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
	 * hatch before NL search gives up. NL searches never surface `invalidPattern`/`invalidRef` wording —
	 * that's meaningless to a user who never typed the operators themselves.
	 */
	private async searchNaturalLanguageWithRepair(
		e: IpcParams<typeof SearchRequest>,
		naturalLanguage: { query: string; processedQuery?: string; error?: string },
		repair: { attempted: boolean; succeeded: boolean },
	): Promise<IpcResponse<typeof SearchRequest>> {
		try {
			return await this.searchGraphOrContinue(e, true, { suppressFallback: true });
		} catch (ex) {
			if (isCancellationError(ex)) throw ex;

			if (!GitSearchError.is(ex) || ex.reason == null) throw ex;

			repair.attempted = true;
			// Captured before the AI round-trip so a superseding search during it is detected below.
			const searchId = this._searchIdCounter.current;

			const repaired = await this.convertNaturalLanguage(
				{ ...e.search, query: naturalLanguage.query, naturalLanguage: { query: naturalLanguage.query } },
				{ context: buildRepairContext(e.search.query, toGraphSearchResultsError(ex).error) },
			);

			if (this._searchIdCounter.current !== searchId) {
				return { search: undefined, results: undefined, partial: false, searchId: searchId };
			}

			const repairedNaturalLanguage =
				typeof repaired.naturalLanguage === 'object' ? repaired.naturalLanguage : undefined;

			if (repairedNaturalLanguage?.error == null && repaired.query !== e.search.query) {
				try {
					const response = await this.searchGraphOrContinue({ ...e, search: repaired }, true);
					repair.succeeded = true;
					return response;
				} catch (retryEx) {
					if (isCancellationError(retryEx)) throw retryEx;
					// Repaired query also failed — fall through to the last resort below.
				}
			}

			try {
				return await this.searchGraphOrContinue(e, true);
			} catch (lastEx) {
				if (isCancellationError(lastEx)) throw lastEx;

				return {
					search: e.search,
					results: { error: "Couldn't complete this search — try rephrasing" },
					partial: false,
					searchId: this._searchIdCounter.current,
				};
			}
		}
	}

	async searchGraphOrContinue(
		e: IpcParams<typeof SearchRequest>,
		progressive: boolean = true,
		options?: { suppressFallback?: boolean },
	): Promise<IpcResponse<typeof SearchRequest>> {
		// `type:wip` rows are synthetic webview-only rows that never appear in `git log`,
		// so they're enumerated host-side instead of going through the regular search path.
		const wipResponse = await this.tryHandleWipSearch(e);
		if (wipResponse != null) return wipResponse;

		let search = this._search;

		const graph = this.context.getSession()!.current;

		if (
			e.more &&
			search?.paging?.cursor != null &&
			search.comparisonKey === getSearchQueryComparisonKey(e.search)
		) {
			if (this.repository == null) {
				return {
					search: e.search,
					results: { error: 'No repository' },
					partial: false,
					searchId: this._searchIdCounter.current,
				};
			}

			const searchId = this._searchIdCounter.current;
			const cancellation = this.context.createSearchCancellation();

			try {
				// Continue search from cursor, passing existing results
				const searchStream = this.repository.git.graph.continueSearchGraph(
					search.paging.cursor,
					search.results,
					{
						limit: e.limit ?? configuration.get('graph.searchItemLimit') ?? 0,
					},
					toAbortSignal(cancellation.token),
				);
				using _streamDisposer = createDisposable(() => void searchStream.return?.(undefined!));

				({ search } = await this.processSearchStream(searchStream, searchId, progressive, graph));

				if (search != null && searchId === this._searchIdCounter.current) {
					return {
						search: e.search,
						results: this.getSearchResultsData(search),
						partial: false,
						searchId: searchId,
					};
				}

				return {
					search: e.search,
					results: undefined,
					partial: false,
					searchId: searchId,
				};
			} finally {
				cancellation.dispose();
			}
		}

		let firstResultSelected = false;

		// Captured once and used for both the cached-results notify and the final return so that
		// awaits in either branch can't race a newer search bumping `_searchIdCounter.current` and
		// stamping our response with the wrong (newer) id. In the new-search branch this gets
		// reassigned to the bumped value.
		let searchId = this._searchIdCounter.current;

		if (search?.comparisonKey !== getSearchQueryComparisonKey(e.search)) {
			if (this.repository == null) {
				return {
					search: e.search,
					results: { error: 'No repository' },
					partial: false,
					searchId: searchId,
				};
			}

			if (this.repository.etag !== this.context.getEtagRepository()) {
				this.context.updateState(true);
			}

			// Increment search ID for new search
			searchId = this._searchIdCounter.next();
			this._search = undefined;
			this._fallback = undefined;

			// Clear previous search results immediately
			void this.host.notify(DidSearchNotification, {
				search: e.search,
				results: undefined,
				partial: false,
				searchId: searchId,
			});

			const cancellation = this.context.createSearchCancellation();

			try {
				const searchStream = this.repository.git.graph.searchGraph(
					e.search,
					{
						limit: configuration.get('graph.searchItemLimit') ?? 0,
						ordering: configuration.get('graph.commitOrdering'),
					},
					toAbortSignal(cancellation.token),
				);
				using _streamDisposer = createDisposable(() => void searchStream.return?.(undefined!));

				({ search, firstResultSelected } = await this.processSearchStream(
					searchStream,
					searchId,
					progressive,
					graph,
					{ selectFirstResult: true },
				));

				if (search == null) {
					if (searchId !== this._searchIdCounter.current) {
						// Search was superseded — return quietly with the original searchId
						// so the webview's searchId guard ignores this stale response
						return {
							search: e.search,
							results: undefined,
							partial: false,
							searchId: searchId,
						};
					}
					throw new Error('Search generator completed without returning a result');
				}
			} catch (ex) {
				if (searchId !== this._searchIdCounter.current) {
					// Search was superseded — return with the original (stale) searchId
					// so the webview's searchId guard ignores this response
					return {
						search: e.search,
						results: undefined,
						partial: false,
						searchId: searchId,
					};
				}

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
							toAbortSignal(cancellation.token),
						);
						using _fallbackStreamDisposer = createDisposable(
							() => void fallbackStream.return?.(undefined!),
						);

						({ search, firstResultSelected } = await this.processSearchStream(
							fallbackStream,
							searchId,
							progressive,
							graph,
							{ selectFirstResult: true },
						));

						if (search == null) {
							if (searchId !== this._searchIdCounter.current) {
								return {
									search: e.search,
									results: undefined,
									partial: false,
									searchId: searchId,
								};
							}
							throw new Error('Fallback search generator completed without returning a result', {
								cause: ex,
							});
						}

						// The provider computed `comparisonKey` from the executed (literal) query — patch it
						// back to the original so a later `e.more` continuation (which always sends the
						// original query) still matches and continues from the literal cursor.
						search = { ...search, comparisonKey: getSearchQueryComparisonKey(e.search) };
					} catch {
						if (searchId !== this._searchIdCounter.current) {
							return {
								search: e.search,
								results: undefined,
								partial: false,
								searchId: searchId,
							};
						}

						this._fallback = undefined;
						this._search = undefined;
						throw ex; // surface the original classified error, not the fallback attempt's
					}
				} else {
					this._search = undefined;
					throw ex;
				}
			}

			// Only update _search if this search hasn't been superseded by a newer one
			if (searchId === this._searchIdCounter.current) {
				this._search = updateSearchMode(this.container, search);
			}
		} else {
			search = this._search!;

			// Select first result if not already selected (for cached searches)
			if (!firstResultSelected) {
				const firstResult = await this.ensureSearchStartsInRange(graph, search.results);
				if (firstResult != null) {
					this.context.setSelectedRows(firstResult);
					firstResultSelected = true;
				}
			}

			// Send notification with cached results (only if not superseded and not resuming)
			// When resuming (e.more), don't send cached results - let progressive notifications handle it
			if (searchId != null && progressive && !e.more) {
				// Use search.query to include any mode changes (filter toggle) that happened during the search
				void this.host.notify(DidSearchNotification, {
					search: this.publicSearchQuery(search.query),
					results: this.getSearchResultsData(search) ?? {
						count: 0,
						hasMore: false,
						commitsLoaded: { count: 0 },
					},
					selectedRows: firstResultSelected ? this.context.getConvertedSelectedRows() : undefined,
					partial: false,
					fallback: this.buildFallbackParam(),
					searchId: searchId,
				});
			}
		}

		return {
			search: this.publicSearchQuery(search.query),
			results: this.getSearchResultsData(search) ?? { count: 0, hasMore: false, commitsLoaded: { count: 0 } },
			selectedRows: firstResultSelected ? this.context.getConvertedSelectedRows() : undefined,
			partial: false, // Final results
			fallback: this.buildFallbackParam(),
			searchId: searchId,
		};
	}

	private async tryHandleWipSearch(
		e: IpcParams<typeof SearchRequest>,
	): Promise<IpcResponse<typeof SearchRequest> | undefined> {
		if (!e.search?.query) return undefined;

		const parsed = parseSearchQueryGitCommand(e.search, undefined);
		if (parsed.filters.type !== 'wip') return undefined;

		if (this.repository == null) {
			return {
				search: e.search,
				results: { error: 'No repository' },
				partial: false,
				searchId: this._searchIdCounter.current,
			};
		}

		const comparisonKey = getSearchQueryComparisonKey(e.search);

		// Same wip query as the cached one (covers `e.more` too) — re-emit the cached results.
		if (this._search?.comparisonKey === comparisonKey) {
			const cached = this.getSearchResultsData(this._search) ?? {
				count: 0,
				hasMore: false,
				commitsLoaded: { count: 0 },
			};
			return {
				search: e.search,
				results: cached,
				partial: false,
				searchId: this._searchIdCounter.current,
			};
		}

		// Cancel any in-flight regular search before superseding. Otherwise the regular search's
		// git stream keeps running until the outer function unwinds, wasting work and (paired with
		// stale `_search` reads) potentially poisoning the WIP search's results.
		this.context.cancelSearchOperation();

		const searchId = this._searchIdCounter.next();
		this._search = undefined;
		this._fallback = undefined;

		void this.host.notify(DidSearchNotification, {
			search: e.search,
			results: undefined,
			partial: false,
			searchId: searchId,
		});

		// Use the same enumeration that feeds the rendered WIP rows so search and rendering agree.
		const wipRowsById = await this.context.getWipRows();

		if (searchId !== this._searchIdCounter.current) {
			return {
				search: e.search,
				results: undefined,
				partial: false,
				searchId: searchId,
			};
		}

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

		this.context.setSelectedRows(primaryWipRowId);
		const selectedRows = this.context.getConvertedSelectedRows();

		const resultData = this.getSearchResultsData(this._search) ?? {
			count: 0,
			hasMore: false,
			commitsLoaded: { count: 0 },
		};

		void this.host.notify(DidSearchNotification, {
			search: e.search,
			results: resultData,
			selectedRows: selectedRows,
			partial: false,
			searchId: searchId,
		});

		return {
			search: e.search,
			results: resultData,
			selectedRows: selectedRows,
			partial: false,
			searchId: searchId,
		};
	}

	private async processSearchStream(
		searchStream: AsyncGenerator<GitGraphSearchProgress, GitGraphSearch, void>,
		searchId: number,
		progressive: boolean,
		graph: GitGraph,
		options?: { selectFirstResult?: boolean },
	): Promise<{ search: GitGraphSearch | undefined; firstResultSelected: boolean }> {
		// Snapshot `_search` so we can restore it if this stream gets superseded — the in-loop write
		// at `this._search = updateSearchMode(...)` below stamps partial results of THIS search into
		// `_search`, and if a newer search starts mid-loop those partial results would otherwise
		// survive and poison `getSearchContext`, `updateGraphWithMoreRows`, and the bootstrap state.
		// We compare by object identity (not just truthiness) so we never clobber the newer search's
		// `_search` if it already wrote past ours.
		const priorSearch = this._search;
		let ourLastWrite: GitGraphSearch | undefined;
		let search: GitGraphSearch | undefined;
		let firstResultSelected = false;

		let result: IteratorResult<GitGraphSearchProgress, GitGraphSearch> | undefined;
		while (!(result = await searchStream.next()).done) {
			// Break out if search was cancelled or a new search started
			if (searchId !== this._searchIdCounter.current) break;

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
			this._search = updateSearchMode(this.container, search);
			ourLastWrite = this._search;

			// Select first result as soon as we find one (only once)
			let selectedRows: GraphSelectedRows | undefined;
			if (options?.selectFirstResult && !firstResultSelected) {
				const firstResult = await this.ensureSearchStartsInRange(graph, progress.results);
				if (firstResult != null) {
					this.context.setSelectedRows(firstResult);
					selectedRows = this.context.getConvertedSelectedRows();
					firstResultSelected = true;
				}
			}

			if (progressive) {
				// Send only the incremental batch to frontend (not all accumulated results)
				void this.host.notify(DidSearchNotification, {
					search: this.publicSearchQuery(this._search.query),
					results: this.getSearchResultsData(progress),
					selectedRows: selectedRows,
					partial: true,
					fallback: this.buildFallbackParam(),
					searchId: searchId,
				});
			}
		}

		// Skip final result processing if this search has been superseded
		if (searchId !== this._searchIdCounter.current) {
			// Restore the pre-loop `_search` only if it still holds OUR partial write — by the time
			// we get here the newer search's processStream may have already written its own results;
			// identity comparison guards against clobbering them.
			if (this._search === ourLastWrite) {
				this._search = priorSearch;
			}
			return { search: search, firstResultSelected: firstResultSelected };
		}

		// Get final result from generator
		if (result?.value != null) {
			search = result.value;
			this._search = updateSearchMode(this.container, search);
			// Last chance to select: a per-batch attempt above misses whenever a concurrent paging walk
			// supersedes its page-in, and without a selection here nothing ever reveals the match. Re-check
			// the id after the await — `setSelectedRows` is a blind write that would stomp a newer search.
			const firstResult = await this.ensureSearchStartsInRange(graph, search.results);
			if (
				options?.selectFirstResult &&
				!firstResultSelected &&
				firstResult != null &&
				searchId === this._searchIdCounter.current
			) {
				this.context.setSelectedRows(firstResult);
				firstResultSelected = true;
			}

			// Send final notification with complete results
			if (progressive) {
				void this.host.notify(DidSearchNotification, {
					search: this.publicSearchQuery(this._search.query),
					results: this.getSearchResultsData(search) ?? {
						count: 0,
						hasMore: false,
						commitsLoaded: { count: 0 },
					},
					selectedRows:
						options?.selectFirstResult && firstResultSelected
							? this.context.getConvertedSelectedRows()
							: undefined,
					partial: false,
					fallback: this.buildFallbackParam(),
					searchId: searchId,
				});
			}
		}

		return { search: search, firstResultSelected: firstResultSelected };
	}

	onSearchOpenInView(params: IpcParams<typeof SearchOpenInViewCommand>): void {
		if (this.repository == null) return;

		void this.container.views.searchAndCompare.search(this.repository.path, params.search, {
			label: { label: `for ${params.search.query}` },
			reveal: { select: true, focus: false, expand: true },
		});
	}

	/** Asks AI to repair a hand-written search query git refused to compile. */
	async onSearchRepairRequest(
		params: IpcParams<typeof SearchRepairRequest>,
	): Promise<IpcResponse<typeof SearchRepairRequest>> {
		try {
			const converted = await this.convertNaturalLanguage(
				{ query: params.query, naturalLanguage: { query: params.query } },
				{ context: buildRepairContext(params.query, params.detail) },
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
		}
	}

	private getSearchResultsData(
		search: GitGraphSearch | GitGraphSearchProgress | undefined,
	): GraphSearchResults | undefined {
		if (!search?.results?.size) return undefined;

		// Count the commits for these search results that are loaded in the graph
		const commitsLoaded: { count: number } = { count: 0 };
		if (search.queryFilters?.type === 'wip') {
			// `type:wip` results are synthetic WIP rows, not real commits — they never appear in
			// the session's `ids`, and the full set is enumerated up front (one per worktree). There are
			// no commits to page in, so treat them all as loaded; otherwise filter mode pages
			// through the entire history trying to "fill" the viewport with matches.
			commitsLoaded.count = search.results.size;
		} else {
			const session = this.context.getSession();
			if (session != null) {
				const ids = session.current.ids;
				for (const sha of search.results.keys()) {
					if (ids.has(sha)) {
						commitsLoaded.count++;
					}
				}
			}
		}

		return {
			ids: Object.fromEntries(search.results),
			count: search.results.size,
			hasMore: search.hasMore,
			commitsLoaded: commitsLoaded,
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

	onUpdateGraphSearchMode(params: IpcParams<typeof UpdateGraphSearchModeCommand>): void {
		void this.container.storage.store('graph:searchMode', params.searchMode).catch();
		void this.container.storage.store('graph:useNaturalLanguageSearch', params.useNaturalLanguage).catch();

		// Update the active search query's filter property to match the new mode
		updateSearchMode(this.container, this._search, params.searchMode);
	}

	/** The rider state last shipped (`searchId|count|commitsLoaded`), so unchanged riders are skipped. */
	private _lastRiderKey: string | undefined;

	/** How many of the search's result shas are loaded in the session's window — the piece of the rider
	 *  payload that paging actually changes (cheap membership count; no serialization). */
	private countLoadedSearchResults(search: GitGraphSearch): number {
		if (search.queryFilters?.type === 'wip') return search.results.size;

		const ids = this.context.getSession()?.current.ids;
		if (ids == null) return 0;

		let count = 0;
		for (const sha of search.results.keys()) {
			if (ids.has(sha)) {
				count++;
			}
		}
		return count;
	}

	/** Current search-results envelope to ride the next rows-plane emission, or `undefined` when there
	 *  is no ACTIVE search, or nothing changed since the last-shipped rider — the results map is
	 *  O(matches) to serialize + merge app-side, and every scroll page-in emits a rows notification, so
	 *  an ungated rider re-ships thousands of filter-mode matches per page. An active zero-result search
	 *  still ships a present-but-empty envelope (so a rebooted app restores "query X, 0 matches"). */
	buildSearchRider(): DidSearchParams | undefined {
		const search = this._search;
		// Gate on an ACTIVE search, not on having matches: a zero-result search must still ship an
		// authoritative envelope so a rebooted app restores "query X, 0 matches" (and its search box)
		// rather than showing nothing. No active search at all → nothing to restore → no rider.
		if (search == null) return undefined;

		const size = search.results?.size ?? 0;
		const riderKey = `${this._searchIdCounter.current}|${size}|${this.countLoadedSearchResults(search)}`;
		if (riderKey === this._lastRiderKey) return undefined;

		this._lastRiderKey = riderKey;
		return {
			search: this.publicSearchQuery(search.query),
			// A present-but-empty envelope for a zero-result search (getSearchResultsData returns undefined
			// when the map is empty — the app would treat undefined+undefined-query as a cancel/clear).
			results: this.getSearchResultsData(search) ?? {
				ids: {},
				count: 0,
				hasMore: search.hasMore ?? false,
				commitsLoaded: { count: 0 },
			},
			// A rider is a results/coverage REFRESH, not a progress signal — stamped so the app doesn't
			// derive `searching` from it (an active progressive search's spinner would flicker off, and
			// jump-to-last could skip its wait-for-complete on a partial result set).
			rider: true,
			partial: false,
			fallback: this.buildFallbackParam(),
			searchId: this._searchIdCounter.current,
		};
	}

	/** Un-gate the next search rider (see {@link buildSearchRider}'s dedup) — for (re)connects, where the
	 *  app rebooted without search results and needs the full envelope re-shipped even though nothing
	 *  changed host-side. */
	invalidateRider(): void {
		this._lastRiderKey = undefined;
	}

	resetSearchState(): void {
		this._nlCancellation?.cancel();
		this._nlCancellation?.dispose();
		this._nlCancellation = undefined;

		this._search = undefined;
		this._fallback = undefined;
		this._lastRiderKey = undefined;
		this.context.cancelSearchOperation();
		// Bump so any in-flight search's late notifications drop on the app's searchId guard, and push
		// the clear so the webview's results/query don't outlive the state they were computed from —
		// without this a REPO SWAP left the previous repo's match count and result shas in the search
		// box, and navigating them silently failed against the new repo's graph.
		this._searchIdCounter.next();
		void this.host.notify(DidSearchNotification, {
			search: undefined,
			results: undefined,
			partial: false,
			searchId: this._searchIdCounter.current,
		});
	}

	/** Drop the cached per-repo search history so the next request rebuilds it for the current repo. */
	resetHistory(): void {
		this._searchHistory = undefined;
	}
}

function updateSearchMode<T extends GitGraphSearch | undefined>(
	container: Container,
	search: T,
	mode?: GraphSearchMode,
): T {
	if (search?.query != null) {
		mode ??= container.storage.get('graph:searchMode', 'normal');
		search.query.filter = mode === 'filter';
	}
	return search;
}
