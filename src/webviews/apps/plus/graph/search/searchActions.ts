import type { SearchQuery } from '@gitlens/git/models/search.js';
import { defer } from '@gitlens/utils/promise.js';
import type {
	GraphPickersService,
	GraphSearchResponse,
	GraphSearchService,
} from '../../../../plus/graph/graphService.js';
import type {
	DidChooseAuthorParams,
	DidChooseComparisonParams,
	DidChooseFileParams,
	DidChooseRefParams,
	DidSearchHistoryGetParams,
	DidSearchRepairParams,
	GraphSearchMode,
	SearchParams,
} from '../../../../plus/graph/protocol.js';
import { CancellableRequest } from '../../../shared/cancellableRequest.js';
import type { GraphStateProvider } from '../stateProvider.js';

export interface SearchActions {
	initialize(service: GraphSearchService, state: GraphStateProvider, pickers: GraphPickersService): void;
	search(params: SearchParams): Promise<GraphSearchResponse | undefined>;
	/** Cancels the in-flight request only — a pause, not a clear. The host still owns the accumulated
	 *  results, so a later `search({ ..., more: true })` resumes from where this left off. */
	cancel(): void;
	clear(): void;
	/** Persists the sticky search preferences. `searchMode: undefined` leaves the mode untouched —
	 *  for callers reporting an NL-preference change without a mode choice. */
	setMode(searchMode: GraphSearchMode | undefined, useNaturalLanguage: boolean): void;
	openInView(search: SearchQuery): void;
	repair(query: string, detail?: string): Promise<DidSearchRepairParams>;
	getHistory(): Promise<DidSearchHistoryGetParams>;
	storeHistory(search: SearchQuery): Promise<DidSearchHistoryGetParams>;
	deleteHistory(query: string): Promise<DidSearchHistoryGetParams>;
	/** Opens the branch/tag picker — waits for `initialize()` if called before the RPC handshake lands. */
	chooseRef(
		title: string,
		placeholder: string,
		options?: Parameters<GraphPickersService['chooseRef']>[2],
	): Promise<DidChooseRefParams>;
	chooseComparison(title: string): Promise<DidChooseComparisonParams>;
	chooseAuthor(title: string, placeholder: string, picked?: string[]): Promise<DidChooseAuthorParams>;
	chooseFile(
		title: string,
		type: 'file' | 'folder',
		options?: Parameters<GraphPickersService['chooseFile']>[2],
	): Promise<DidChooseFileParams>;
	dispose(): void;
}

export function createSearchActions(): SearchActions {
	let service: GraphSearchService | undefined;
	let state: GraphStateProvider | undefined;
	let pickers: GraphPickersService | undefined;
	let unsubscribe: (() => void) | undefined;
	// Bumped by `search()` and read by `initialize()`'s seed — a search the user started while the seed
	// was still resolving must win; re-applying a stale seed on top of it would revert the box/results.
	let searchIssuedSinceInit = false;
	// Set by `search()` when it's called before `initialize()` has run — replayed once `initialize()`
	// assigns `service`, so a bootstrap-seeded external search isn't silently dropped.
	let pendingSearch: SearchParams | undefined;
	// Set by `cancel()` (a pause) and cleared by the next `search()`. A pause settles `searching: false`
	// locally (the host answers an aborted search with nothing), but a progressive snapshot fired just
	// before the abort reached the host can still arrive AFTER that — and nothing would ever drop the
	// `searching: true` it re-raises. Until the next search, incoming snapshots apply with `searching`
	// forced off; every other field stays authoritative.
	let pausedSinceLastSearch = false;

	const request = new CancellableRequest();
	// Resolved once `initialize()` assigns `service` — callers that need `service` up front (e.g.
	// `getHistory()`) await this instead of racing the RPC handshake.
	const serviceReady = defer<void>();

	const actions: SearchActions = {
		initialize: function (svc: GraphSearchService, st: GraphStateProvider, pks: GraphPickersService) {
			// Tear down any prior subscription first — reconnect-safe (e.g. RPC reconnection).
			unsubscribe?.();
			unsubscribe = undefined;

			service = svc;
			state = st;
			pickers = pks;
			searchIssuedSinceInit = false;
			serviceReady.fulfill();

			if (pendingSearch != null) {
				const stashed = pendingSearch;
				pendingSearch = undefined;

				void actions.search(stashed);
			}

			const activeSvc = svc;

			// Supertalk RPC marshals subscription methods as `Promise<Unsubscribe>`, so the call must be
			// awaited — synchronous assignment captures the Promise (not callable) and breaks teardown
			// with `is not a function`.
			void (async () => {
				const unsub = (await activeSvc.onDidChange(s =>
					state?.applySearchState(pausedSinceLastSearch && s?.searching ? { ...s, searching: false } : s),
				)) as unknown as (() => void) | undefined;
				if (typeof unsub !== 'function') return;
				if (service !== activeSvc) {
					unsub();
					return;
				}

				unsubscribe = unsub;
			})();

			void (async () => {
				const seeded = await activeSvc.getState();
				// Bail if a newer `initialize` has already superseded this one, or a search the user
				// started while the seed was in flight must not be clobbered by it landing afterwards.
				if (service !== activeSvc || searchIssuedSinceInit) return;

				state?.applySearchState(seeded);
			})();
		},

		search: async function (params: SearchParams) {
			searchIssuedSinceInit = true;
			pausedSinceLastSearch = false;
			if (service == null) {
				pendingSearch = params;
				return undefined;
			}

			const result = await request.run(signal => service!.search(params, signal));
			// Superseded or aborted — leave state untouched.
			if (result == null) return undefined;

			if (result.value?.state != null) {
				state?.applySearchState(result.value.state);
			}

			return result.value;
		},

		cancel: function () {
			pausedSinceLastSearch = true;
			request.cancel();
			// The request signal only reaches the search's own operation — the host ALSO runs background
			// continuations (auto-load-more during a rows page-in) under their own signals, which would
			// otherwise keep git running through the pause and later clobber the paused results with the
			// full tally (hasMore false — no resume).
			service?.cancel();
		},

		clear: function () {
			pausedSinceLastSearch = false;
			request.cancel();
			service?.clear();
		},

		setMode: function (searchMode: GraphSearchMode | undefined, useNaturalLanguage: boolean) {
			service?.setMode(searchMode, useNaturalLanguage);
		},

		openInView: function (search: SearchQuery) {
			service?.openInView(search);
		},

		repair: function (query: string, detail?: string) {
			return service?.repair(query, detail) ?? Promise.resolve({ query: undefined });
		},

		getHistory: async function () {
			await serviceReady.promise;

			return service!.getHistory();
		},

		storeHistory: function (search: SearchQuery) {
			return service?.storeHistory(search) ?? Promise.resolve({ history: [] });
		},

		deleteHistory: function (query: string) {
			return service?.deleteHistory(query) ?? Promise.resolve({ history: [] });
		},

		chooseRef: async function (title, placeholder, options) {
			await serviceReady.promise;

			return pickers!.chooseRef(title, placeholder, options);
		},

		chooseComparison: async function (title) {
			await serviceReady.promise;

			return pickers!.chooseComparison(title);
		},

		chooseAuthor: async function (title, placeholder, picked) {
			await serviceReady.promise;

			return pickers!.chooseAuthor(title, placeholder, picked);
		},

		chooseFile: async function (title, type, options) {
			await serviceReady.promise;

			return pickers!.chooseFile(title, type, options);
		},

		dispose: function () {
			unsubscribe?.();
			request.cancel();
		},
	};

	return actions;
}
