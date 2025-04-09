import type { CssVariables } from '@gitkraken/gitkraken-components';
import { ContextProvider, createContext } from '@lit/context';
import type { ReactiveControllerHost } from 'lit';
import type { SearchQuery } from '../../../../constants.search';
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
	DidChangeNotification,
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
import type { StateProvider } from '../../shared/app';
import { signalObjectState, signalState } from '../../shared/components/signal-utils';
import type { LoggerContext } from '../../shared/contexts/logger';
import type { Disposable } from '../../shared/events';
import type { HostIpc } from '../../shared/ipc';
import { stateContext } from './context';

type ReactiveElementHost = Partial<ReactiveControllerHost> & HTMLElement;

interface AppState {
	activeDay?: number;
	activeRow?: string;
	visibleDays?: {
		top: number;
		bottom: number;
	};
	theming?: { cssVariables: CssVariables; themeOpacityFactor: number };
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

export class GraphAppState implements AppState {
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

	@signalObjectState()
	accessor theming: AppState['theming'];

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

	@signalState()
	accessor searchResultsResponse: undefined | GraphSearchResults | GraphSearchResultsError;

	get searchResults() {
		return getSearchResultModel(this.searchResultsResponse).results;
	}

	get searchResultsError() {
		return getSearchResultModel(this.searchResultsResponse).resultsError;
	}

	@signalState()
	accessor selectedRows: undefined | GraphSelectedRows;
}

export const graphStateContext = createContext<GraphAppState>('graphState');

export class GraphStateProvider implements StateProvider<State> {
	private readonly disposable: Disposable;
	private readonly provider: ContextProvider<{ __context__: State }, ReactiveElementHost>;

	private readonly _state: State;
	get state() {
		return this._state;
	}

	private updateState(partial: Partial<State>) {
		for (const key in partial) {
			// @ts-expect-error dynamic object key ejection doesn't work in typescript
			this._state[key] = partial[key];
		}
		this.options.onStateUpdate?.(partial);
		this.provider.setValue(this._state, true);
	}

	constructor(
		host: ReactiveElementHost,
		state: State,
		private readonly _ipc: HostIpc,
		private readonly _logger: LoggerContext,
		private readonly options: { onStateUpdate?: (partial: Partial<State>) => void } = {},
	) {
		this._state = state;
		this.provider = new ContextProvider(host, { context: stateContext, initialValue: state });

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
