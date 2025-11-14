import { ContextProvider } from '@lit/context';
import { debounce } from '../../../../system/function/debounce';
import { getLogScope, setLogScopeExit } from '../../../../system/logger.scope';
import type { DidSearchParams, GraphSearchResults, GraphSearchResultsError, State } from '../../../plus/graph/protocol';
import {
	DidChangeAvatarsNotification,
	DidChangeBranchStateNotification,
	DidChangeColumnsNotification,
	DidChangeGraphConfigurationNotification,
	DidChangeMcpBanner,
	DidChangeNotification,
	DidChangeOrgSettings,
	DidChangeRefsMetadataNotification,
	DidChangeRefsVisibilityNotification,
	DidChangeRepoConnectionNotification,
	DidChangeRowsNotification,
	DidChangeRowsStatsNotification,
	DidChangeScrollMarkersNotification,
	DidChangeSelectionNotification,
	DidChangeSubscriptionNotification,
	DidChangeWorkingTreeNotification,
	DidFetchNotification,
	DidSearchNotification,
	DidStartFeaturePreviewNotification,
} from '../../../plus/graph/protocol';
import type { IpcMessage, WebviewState } from '../../../protocol';
import { DidChangeHostWindowFocusNotification } from '../../../protocol';
import type { ReactiveElementHost } from '../../shared/appHost';
import { signalObjectState, signalState } from '../../shared/components/signal-utils';
import type { LoggerContext } from '../../shared/contexts/logger';
import type { HostIpc } from '../../shared/ipc';
import { StateProviderBase } from '../../shared/stateProviderBase';
import type { AppState } from './context';
import { graphStateContext } from './context';

const BaseWebviewStateKeys = [
	'timestamp',
	'webviewId',
	'webviewInstanceId',
] as const satisfies readonly (keyof WebviewState<any>)[] as readonly string[];

export function isGraphSearchResultsError(
	results: GraphSearchResults | GraphSearchResultsError,
): results is GraphSearchResultsError {
	return 'error' in results;
}

function getSearchResultModel(searchResults: State['searchResults']): {
	results: undefined | GraphSearchResults;
	resultsError: undefined | GraphSearchResultsError;
} {
	let results: undefined | GraphSearchResults;
	let resultsError: undefined | GraphSearchResultsError;
	if (searchResults != null) {
		if (isGraphSearchResultsError(searchResults)) {
			resultsError = searchResults;
		} else {
			results = searchResults;
		}
	}
	return { results: results, resultsError: resultsError };
}

export class GraphStateProvider extends StateProviderBase<State['webviewId'], AppState, typeof graphStateContext> {
	// Track current search ID to ignore stale updates
	private _currentSearchId: number | undefined;

	// App state members moved from GraphAppState
	@signalState()
	accessor activeDay: AppState['activeDay'];

	@signalState()
	accessor activeRow: AppState['activeRow'];

	get isBusy(): AppState['isBusy'] {
		return this.loading || this.searching || /*this.rowsStatsLoading ||*/ false;
	}

	@signalState(false)
	accessor loading: AppState['loading'] = false;

	@signalState<AppState['navigating']>(false)
	accessor navigating: AppState['navigating'] = false;

	@signalState(false)
	accessor searching: AppState['searching'] = false;

	@signalState()
	accessor searchMode: AppState['searchMode'] = 'normal';

	@signalState<GraphSearchResults | GraphSearchResultsError | undefined>(undefined, {
		afterChange: (target, value) => {
			const { results, resultsError } = getSearchResultModel(value);
			target.searchResults = results;
			target.searchResultsError = resultsError;
		},
	})
	accessor searchResultsResponse: AppState['searchResultsResponse'];

	@signalState()
	accessor searchResults: AppState['searchResults'];

	@signalState()
	accessor searchResultsError: AppState['searchResultsError'];

	@signalState()
	accessor selectedRows: AppState['selectedRows'];

	@signalObjectState()
	accessor visibleDays: AppState['visibleDays'];

	// State accessors for all top-level State properties
	@signalState()
	accessor windowFocused: boolean | undefined;

	@signalState()
	accessor webroot: string | undefined;

	@signalState()
	accessor repositories: State['repositories'];

	@signalState()
	accessor selectedRepository: State['selectedRepository'];

	@signalState()
	accessor selectedRepositoryVisibility: State['selectedRepositoryVisibility'];

	@signalState()
	accessor branchesVisibility: State['branchesVisibility'];

	@signalState()
	accessor branch: State['branch'];

	@signalState()
	accessor branchState: State['branchState'];

	@signalState()
	accessor lastFetched: State['lastFetched'];

	@signalState()
	accessor subscription: State['subscription'];

	@signalState()
	accessor allowed: State['allowed'] = false;

	@signalState()
	accessor avatars: State['avatars'];

	@signalState()
	accessor refsMetadata: State['refsMetadata'];

	@signalState()
	accessor rows: State['rows'];

	@signalState()
	accessor rowsStats: State['rowsStats'];

	@signalState()
	accessor rowsStatsLoading: State['rowsStatsLoading'] | undefined;

	@signalState()
	accessor downstreams: State['downstreams'];

	@signalState()
	accessor paging: State['paging'];

	@signalState()
	accessor columns: State['columns'];

	@signalState()
	accessor config: State['config'];

	@signalState()
	accessor context: State['context'];

	@signalState()
	accessor nonce: State['nonce'];

	@signalState()
	accessor workingTreeStats: State['workingTreeStats'];

	@signalState()
	accessor useNaturalLanguageSearch: State['useNaturalLanguageSearch'] | undefined;

	@signalState()
	accessor searchRequest: State['searchRequest'];

	@signalState()
	accessor excludeRefs: State['excludeRefs'];

	@signalState()
	accessor excludeTypes: State['excludeTypes'];

	@signalState()
	accessor includeOnlyRefs: State['includeOnlyRefs'];

	@signalState()
	accessor featurePreview: State['featurePreview'];

	@signalState()
	accessor orgSettings: State['orgSettings'];

	mcpBannerCollapsed?: boolean | undefined;

	constructor(
		host: ReactiveElementHost,
		bootstrap: string,
		ipc: HostIpc,
		logger: LoggerContext,
		private readonly options: { onStateUpdate?: (partial: Partial<State>) => void } = {},
	) {
		super(host, bootstrap, ipc, logger);
	}

	override dispose(): void {
		// Cancel any pending debounced provider update to prevent post-dispose updates
		this.fireProviderUpdate.cancel?.();
		super.dispose();
	}

	protected override createContextProvider(
		_state: State,
	): ContextProvider<typeof graphStateContext, ReactiveElementHost> {
		return new ContextProvider(this.host, { context: graphStateContext, initialValue: this });
	}

	protected override async initializeState(): Promise<void> {
		await super.initializeState();

		if (this._state.searchMode != null) {
			this.searchMode = this._state.searchMode;
		}

		this.updateState(this._state, true);
	}

	protected onMessageReceived(msg: IpcMessage): void {
		const scope = getLogScope();

		const updates: Partial<State> = {};
		switch (true) {
			case DidChangeNotification.is(msg):
				this.updateState(msg.params.state);
				break;

			case DidFetchNotification.is(msg):
				this._state.lastFetched = msg.params.lastFetched;
				this.updateState({ lastFetched: msg.params.lastFetched });
				break;

			case DidChangeAvatarsNotification.is(msg):
				this.updateState({ avatars: msg.params.avatars });
				break;
			case DidStartFeaturePreviewNotification.is(msg):
				this._state.featurePreview = msg.params.featurePreview;
				this._state.allowed = msg.params.allowed;
				this.updateState({
					featurePreview: msg.params.featurePreview,
					allowed: msg.params.allowed,
				});
				break;
			case DidChangeBranchStateNotification.is(msg):
				this.updateState({
					branchState: msg.params.branchState,
				});
				break;

			case DidChangeHostWindowFocusNotification.is(msg):
				this.updateState({
					windowFocused: msg.params.focused,
				});
				break;

			case DidChangeColumnsNotification.is(msg):
				this.updateState({
					columns: msg.params.columns,
					context: {
						...this._state.context,
						header: msg.params.context,
						settings: msg.params.settingsContext,
					},
				});
				break;

			case DidChangeRefsVisibilityNotification.is(msg):
				this.updateState({
					branchesVisibility: msg.params.branchesVisibility,
					excludeRefs: msg.params.excludeRefs,
					excludeTypes: msg.params.excludeTypes,
					includeOnlyRefs: msg.params.includeOnlyRefs,
				});
				break;

			case DidChangeRefsMetadataNotification.is(msg):
				this.updateState({
					refsMetadata: msg.params.metadata,
				});
				break;

			case DidChangeRowsNotification.is(msg): {
				let rows;
				if (msg.params.rows.length && msg.params.paging?.startingCursor != null && this._state.rows != null) {
					const previousRows = this._state.rows;
					const lastId = previousRows[previousRows.length - 1]?.sha;

					let previousRowsLength = previousRows.length;
					const newRowsLength = msg.params.rows.length;

					this.logger.log(
						scope,
						`paging in ${newRowsLength} rows into existing ${previousRowsLength} rows at ${msg.params.paging.startingCursor} (last existing row: ${lastId})`,
					);

					// Preallocate the array to avoid reallocations
					rows = new Array(previousRowsLength + newRowsLength);

					if (msg.params.paging.startingCursor !== lastId) {
						this.logger.log(scope, `searching for ${msg.params.paging.startingCursor} in existing rows`);

						let i = 0;
						let row;
						for (row of previousRows) {
							rows[i++] = row;
							if (row.sha === msg.params.paging.startingCursor) {
								this.logger.log(scope, `found ${msg.params.paging.startingCursor} in existing rows`);

								previousRowsLength = i;

								if (previousRowsLength !== previousRows.length) {
									// If we stopped before the end of the array, we need to trim it
									rows.length = previousRowsLength + newRowsLength;
								}

								break;
							}
						}
					} else {
						for (let i = 0; i < previousRowsLength; i++) {
							rows[i] = previousRows[i];
						}
					}

					for (let i = 0; i < newRowsLength; i++) {
						rows[previousRowsLength + i] = msg.params.rows[i];
					}
				} else {
					this.logger.log(scope, `setting to ${msg.params.rows.length} rows`);

					if (msg.params.rows.length === 0) {
						rows = this._state.rows;
					} else {
						rows = msg.params.rows;
					}
				}

				updates.avatars = msg.params.avatars;
				updates.downstreams = msg.params.downstreams;
				if (msg.params.refsMetadata !== undefined) {
					updates.refsMetadata = msg.params.refsMetadata;
				}
				updates.rows = rows;
				updates.paging = msg.params.paging;
				if (msg.params.rowsStats != null) {
					updates.rowsStats = { ...this._state.rowsStats, ...msg.params.rowsStats };
				}
				updates.rowsStatsLoading = msg.params.rowsStatsLoading;
				if (msg.params.selectedRows != null) {
					updates.selectedRows = msg.params.selectedRows;
				}
				updates.loading = false;

				if (msg.params.search != null) {
					this.handleSearchNotification(msg.params.search, updates);
				}

				this.updateState(updates);
				setLogScopeExit(scope, ` \u2022 rows=${this._state.rows?.length ?? 0}`);
				break;
			}
			case DidChangeRowsStatsNotification.is(msg):
				this.updateState({
					rowsStats: { ...this._state.rowsStats, ...msg.params.rowsStats },
					rowsStatsLoading: msg.params.rowsStatsLoading,
				});
				break;

			case DidChangeScrollMarkersNotification.is(msg):
				this.updateState({ context: { ...this._state.context, settings: msg.params.context } });
				break;

			case DidSearchNotification.is(msg):
				this.handleSearchNotification(msg.params, updates);
				this.updateState(updates);
				break;
			case DidChangeSelectionNotification.is(msg):
				this.updateState({ selectedRows: msg.params.selection });
				break;

			case DidChangeGraphConfigurationNotification.is(msg):
				this.updateState({ config: msg.params.config });
				break;

			case DidChangeSubscriptionNotification.is(msg):
				this.updateState({
					subscription: msg.params.subscription,
					allowed: msg.params.allowed,
				});
				break;

			case DidChangeOrgSettings.is(msg):
				this.updateState({ orgSettings: msg.params.orgSettings });
				break;

			case DidChangeMcpBanner.is(msg):
				this.updateState({ mcpBannerCollapsed: msg.params });
				break;

			case DidChangeWorkingTreeNotification.is(msg):
				this.updateState({ workingTreeStats: msg.params.stats });
				break;

			case DidChangeRepoConnectionNotification.is(msg):
				this.updateState({ repositories: msg.params.repositories });
				break;
		}
	}

	private handleSearchNotification(params: DidSearchParams, updates: Partial<State>): void {
		const { searchId } = params;

		// Ignore stale notifications from old searches
		if (this._currentSearchId != null && searchId < this._currentSearchId) {
			return;
		}

		// Check if this is a cancellation/clear notification
		const cancelled = params.results == null && params.search == null;

		// Starting a new search - clear previous results
		if (searchId !== this._currentSearchId) {
			this._currentSearchId = searchId;
			// Only set searching=true if this is an actual new search (not a cancellation)
			if (!cancelled) {
				this.searching = true;
			}
			updates.searchResults = undefined;

			// Only update search mode when starting a NEW search
			// Don't update on progressive updates (user may have toggled mode during search)
			if (params.search != null) {
				this.searchMode = params.search.filter ? 'filter' : 'normal';
			}
		}

		// Early exit for cancellation - just clear state
		if (cancelled) {
			updates.searchResults = params.results;
			this.searching = false;
			return;
		}

		if (params.selectedRows != null) {
			updates.selectedRows = params.selectedRows;
		}

		// Process search results
		if (params.results != null) {
			if (isGraphSearchResultsError(params.results)) {
				updates.searchResults = params.results;
				this.searching = false;
			} else {
				// For progressive updates, accumulate the incremental batches
				// Backend sends only new results in each batch to save IPC bandwidth
				if (params.partial && this.searchResults != null && !isGraphSearchResultsError(this.searchResults)) {
					const { ids, count, hasMore, commitsLoaded } = params.results;
					// Merge new IDs with existing ones
					updates.searchResults = {
						ids: { ...this.searchResults.ids, ...ids },
						count: this.searchResults.count + count,
						hasMore: hasMore,
						commitsLoaded: {
							count: this.searchResults.commitsLoaded.count + commitsLoaded.count,
						},
					};
				} else {
					// For final results or first partial update, replace
					updates.searchResults = params.results;
				}

				// Set searching state based on whether this is partial or final
				this.searching = params.partial === true;
			}
		}
	}

	private fireProviderUpdate = debounce(() => this.provider.setValue(this, true), 100);

	protected updateState(partial: Partial<State>, silent?: boolean) {
		let hasChanges = false;
		for (const key in partial) {
			hasChanges = true;

			const value = partial[key as keyof State];
			// @ts-expect-error key is a key of State
			this._state[key] = value;

			if (BaseWebviewStateKeys.includes(key)) continue;

			// Update corresponding accessors
			switch (key) {
				case 'allowed':
					this.allowed = partial.allowed ?? false;
					break;
				case 'loading':
					this.loading = partial.loading ?? false;
					break;
				case 'searchResults':
					// searchResults is managed via searchResultsResponse, so update it specially
					this.searchResultsResponse = value as GraphSearchResults | GraphSearchResultsError | undefined;
					break;
				default:
					// @ts-expect-error key is a key of State
					this[key as keyof Omit<State, 'timestamp' | 'webviewId' | 'webviewInstanceId'>] = value;
					break;
			}
		}

		if (silent || !hasChanges) return;

		this.options.onStateUpdate?.(partial);
		this.fireProviderUpdate();
	}
}
