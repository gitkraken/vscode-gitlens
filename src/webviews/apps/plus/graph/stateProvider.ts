import { ContextProvider, createContext } from '@lit/context';
import type { ReactiveControllerHost } from 'lit';
import type { SearchQuery } from '../../../../constants.search';
import { debounce } from '../../../../system/function/debounce';
import { getLogScope, setLogScopeExit } from '../../../../system/logger.scope';
import type {
	GraphSearchResults,
	GraphSearchResultsError,
	GraphSelectedRows,
	State,
} from '../../../plus/graph/protocol';
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
import { DidChangeHostWindowFocusNotification } from '../../../protocol';
import type { StateProvider } from '../../shared/appHost';
import { signalObjectState, signalState } from '../../shared/components/signal-utils';
import type { LoggerContext } from '../../shared/contexts/logger';
import type { Disposable } from '../../shared/events';
import type { HostIpc } from '../../shared/ipc';

type ReactiveElementHost = Partial<ReactiveControllerHost> & HTMLElement;

interface AppState {
	activeDay?: number;
	activeRow?: string;
	visibleDays?: { top: number; bottom: number };
}

function getSearchResultModel(searchResults: State['searchResults']): {
	results: undefined | GraphSearchResults;
	resultsError: undefined | GraphSearchResultsError;
} {
	let results: undefined | GraphSearchResults;
	let resultsError: undefined | GraphSearchResultsError;
	if (searchResults != null) {
		if ('error' in searchResults) {
			resultsError = searchResults;
		} else {
			results = searchResults;
		}
	}
	return { results: results, resultsError: resultsError };
}

export const graphStateContext = createContext<GraphStateProvider>('graph-state-context');

export class GraphStateProvider implements StateProvider<State>, State, AppState {
	private readonly disposable: Disposable;
	private readonly provider: ContextProvider<{ __context__: GraphStateProvider }, ReactiveElementHost>;

	private readonly _state: State;
	get state() {
		return this._state;
	}

	get webviewId() {
		return this._state.webviewId;
	}

	get webviewInstanceId() {
		return this._state.webviewInstanceId;
	}

	get timestamp() {
		return this._state.timestamp;
	}

	// App state members moved from GraphAppState
	@signalState()
	accessor activeDay: number | undefined;

	@signalState()
	accessor activeRow: string | undefined = undefined;

	@signalState(false)
	accessor loading = false;

	@signalState(false)
	accessor searching = false;

	@signalObjectState()
	accessor visibleDays: AppState['visibleDays'];

	@signalObjectState(
		{ query: '' },
		{
			afterChange: target => {
				target.searchResultsHidden = false;
			},
		},
	)
	accessor filter!: SearchQuery;

	@signalState(false)
	accessor searchResultsHidden = false;

	@signalState<GraphSearchResults | GraphSearchResultsError | undefined>(undefined, {
		afterChange: (target, value) => {
			const { results, resultsError } = getSearchResultModel(value);
			target.searchResults = results;
			target.searchResultsError = resultsError;
		},
	})
	accessor searchResultsResponse: GraphSearchResults | GraphSearchResultsError | undefined;

	@signalState()
	accessor searchResults: GraphSearchResults | undefined;

	@signalState()
	accessor searchResultsError: GraphSearchResultsError | undefined;

	@signalState()
	accessor selectedRows: undefined | GraphSelectedRows;

	// State accessors for all top-level State properties
	@signalState()
	accessor windowFocused: boolean | undefined;

	@signalState()
	accessor webroot: string | undefined;

	@signalState()
	accessor repositories: State['repositories'];

	@signalState()
	accessor selectedRepository: string | undefined;

	@signalState()
	accessor selectedRepositoryVisibility: State['selectedRepositoryVisibility'];

	@signalState()
	accessor branchesVisibility: State['branchesVisibility'];

	@signalState()
	accessor branch: State['branch'];

	@signalState()
	accessor branchState: State['branchState'];

	@signalState()
	accessor lastFetched: Date | undefined;

	@signalState()
	accessor subscription: State['subscription'];

	@signalState()
	accessor allowed: boolean = false;

	@signalState()
	accessor avatars: State['avatars'];

	@signalState()
	accessor refsMetadata: State['refsMetadata'];

	@signalState()
	accessor rows: State['rows'];

	@signalState()
	accessor rowsStats: State['rowsStats'];

	@signalState()
	accessor rowsStatsLoading: boolean | undefined;

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
	accessor nonce: string | undefined;

	@signalState()
	accessor workingTreeStats: State['workingTreeStats'];

	@signalState()
	accessor defaultSearchMode: State['defaultSearchMode'];

	@signalState()
	accessor useNaturalLanguageSearch: boolean | undefined;

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

	get isBusy() {
		return this.loading || this.searching || this.rowsStatsLoading || false;
	}

	private updateState(partial: Partial<State>, silent?: boolean) {
		for (const key in partial) {
			const value = partial[key as keyof State];
			// @ts-expect-error key is a key of State
			this._state[key] = value;

			if (['timestamp', 'webviewId', 'webviewInstanceId'].includes(key)) continue;

			// Update corresponding accessors
			switch (key) {
				case 'allowed':
					this.allowed = partial.allowed ?? false;
					break;
				case 'loading':
					this.loading = partial.loading ?? false;
					break;
				default:
					// @ts-expect-error key is a key of State
					this[key as keyof Omit<State, 'timestamp' | 'webviewId' | 'webviewInstanceId'>] = value;
					break;
			}
		}

		if (silent) return;

		this.options.onStateUpdate?.(partial);
		this.fireProviderUpdate();
	}

	private fireProviderUpdate = debounce(() => this.provider.setValue(this, true), 100);

	constructor(
		host: ReactiveElementHost,
		state: State,
		private readonly _ipc: HostIpc,
		private readonly _logger: LoggerContext,
		private readonly options: { onStateUpdate?: (partial: Partial<State>) => void } = {},
	) {
		this._state = state;
		this.provider = new ContextProvider(host, { context: graphStateContext, initialValue: this });
		this.updateState(state, true);

		this.disposable = this._ipc.onReceiveMessage(msg => {
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
					if (
						msg.params.rows.length &&
						msg.params.paging?.startingCursor != null &&
						this._state.rows != null
					) {
						const previousRows = this._state.rows;
						const lastId = previousRows[previousRows.length - 1]?.sha;

						let previousRowsLength = previousRows.length;
						const newRowsLength = msg.params.rows.length;

						this._logger.log(
							scope,
							`paging in ${newRowsLength} rows into existing ${previousRowsLength} rows at ${msg.params.paging.startingCursor} (last existing row: ${lastId})`,
						);

						rows = [];
						// Preallocate the array to avoid reallocations
						rows.length = previousRowsLength + newRowsLength;

						if (msg.params.paging.startingCursor !== lastId) {
							this._logger.log(
								scope,
								`searching for ${msg.params.paging.startingCursor} in existing rows`,
							);

							let i = 0;
							let row;
							for (row of previousRows) {
								rows[i++] = row;
								if (row.sha === msg.params.paging.startingCursor) {
									this._logger.log(
										scope,
										`found ${msg.params.paging.startingCursor} in existing rows`,
									);

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
						this._logger.log(scope, `setting to ${msg.params.rows.length} rows`);

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
					if (msg.params.searchResults != null) {
						updates.searchResults = msg.params.searchResults;
					}
					if (msg.params.selectedRows != null) {
						updates.selectedRows = msg.params.selectedRows;
					}
					updates.loading = false;
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
					if (msg.params.selectedRows != null) {
						updates.selectedRows = msg.params.selectedRows;
					}
					updates.searchResults = msg.params.results;
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
		});
	}

	dispose(): void {
		this.disposable.dispose();
	}
}
