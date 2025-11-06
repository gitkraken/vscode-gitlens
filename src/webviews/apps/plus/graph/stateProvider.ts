import { ContextProvider } from '@lit/context';
import { debounce } from '../../../../system/function/debounce';
import { getLogScope, setLogScopeExit } from '../../../../system/logger.scope';
import type { GraphSearchResults, GraphSearchResultsError, State } from '../../../plus/graph/protocol';
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

export class GraphStateProvider extends StateProviderBase<State['webviewId'], AppState, typeof graphStateContext> {
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

	@signalState(false)
	accessor searching: AppState['searching'] = false;

	@signalState(false)
	accessor searchResultsHidden: AppState['searchResultsHidden'] = false;

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
	accessor searchMode: AppState['searchMode'] = 'normal';

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
	accessor defaultSearchMode: State['defaultSearchMode'];

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

	protected override createContextProvider(
		_state: State,
	): ContextProvider<typeof graphStateContext, ReactiveElementHost> {
		return new ContextProvider(this.host, { context: graphStateContext, initialValue: this });
	}

	protected override async initializeState(): Promise<void> {
		await super.initializeState();

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
				// Update search mode separately since it's not part of State
				this.searchMode = msg.params.search?.filter ? 'filter' : 'normal';
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

	private fireProviderUpdate = debounce(() => this.provider.setValue(this, true), 100);

	protected updateState(partial: Partial<State>, silent?: boolean) {
		for (const key in partial) {
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

		if (silent) return;

		this.options.onStateUpdate?.(partial);
		this.fireProviderUpdate();
	}
}
