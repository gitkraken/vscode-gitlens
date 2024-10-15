import { ContextProvider, createContext } from '@lit/context';
import type { ReactiveControllerHost } from 'lit';
import type { State } from '../../../../plus/webviews/graph/protocol';
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
} from '../../../../plus/webviews/graph/protocol';
import type { Disposable } from '../../shared/events';
import type { HostIpc } from '../../shared/ipc';

export const stateContext = createContext<State>('graph-state');

type ReactiveElementHost = Partial<ReactiveControllerHost> & HTMLElement;

export class GraphStateProvider implements Disposable {
	private readonly disposable: Disposable;
	private readonly provider: ContextProvider<{ __context__: State }, ReactiveElementHost>;
	private state: State;

	constructor(
		host: ReactiveElementHost,
		state: State,
		private readonly _ipc: HostIpc,
	) {
		this.state = state;
		this.provider = new ContextProvider(host, { context: stateContext, initialValue: state });

		this.disposable = this._ipc.onReceiveMessage(msg => {
			switch (true) {
				case DidChangeNotification.is(msg):
					this.state = { ...this.state, ...msg.params.state };
					this.provider.setValue(this.state, true);
					break;

				case DidFetchNotification.is(msg):
					this.state.lastFetched = msg.params.lastFetched;
					this.provider.setValue(this.state, true);
					break;

				case DidChangeAvatarsNotification.is(msg):
					this.state.avatars = msg.params.avatars;
					this.provider.setValue(this.state, true);
					break;

				case DidChangeBranchStateNotification.is(msg):
					this.state.branchState = msg.params.branchState;
					this.provider.setValue(this.state, true);
					break;

				case DidChangeColumnsNotification.is(msg):
					this.state.columns = msg.params.columns;
					this.state.context = {
						...this.state.context,
						header: msg.params.context,
						settings: msg.params.settingsContext,
					};
					this.provider.setValue(this.state, true);
					break;

				case DidChangeRefsVisibilityNotification.is(msg):
					this.state.branchesVisibility = msg.params.branchesVisibility;
					this.state.excludeRefs = msg.params.excludeRefs;
					this.state.excludeTypes = msg.params.excludeTypes;
					this.state.includeOnlyRefs = msg.params.includeOnlyRefs;
					this.provider.setValue(this.state, true);
					break;

				case DidChangeRefsMetadataNotification.is(msg):
					this.state.refsMetadata = msg.params.metadata;
					this.provider.setValue(this.state, true);
					break;

				case DidChangeRowsNotification.is(msg):
					this.state.avatars = msg.params.avatars;
					this.state.downstreams = msg.params.downstreams;
					if (msg.params.refsMetadata !== undefined) {
						this.state.refsMetadata = msg.params.refsMetadata;
					}
					this.state.rows = msg.params.rows;
					this.state.paging = msg.params.paging;
					if (msg.params.rowsStats != null) {
						this.state.rowsStats = { ...this.state.rowsStats, ...msg.params.rowsStats };
					}
					this.state.rowsStatsLoading = msg.params.rowsStatsLoading;
					if (msg.params.selectedRows != null) {
						this.state.selectedRows = msg.params.selectedRows;
					}
					this.state.loading = false;
					this.provider.setValue(this.state, true);
					break;

				case DidChangeRowsStatsNotification.is(msg):
					this.state.rowsStats = { ...this.state.rowsStats, ...msg.params.rowsStats };
					this.state.rowsStatsLoading = msg.params.rowsStatsLoading;
					this.provider.setValue(this.state, true);
					break;

				case DidChangeScrollMarkersNotification.is(msg):
					this.state.context = { ...this.state.context, settings: msg.params.context };
					this.provider.setValue(this.state, true);
					break;

				case DidSearchNotification.is(msg):
					this.state.searchResults = msg.params.results;
					if (msg.params.selectedRows != null) {
						this.state.selectedRows = msg.params.selectedRows;
					}
					this.provider.setValue(this.state, true);
					break;

				case DidChangeSelectionNotification.is(msg):
					this.state.selectedRows = msg.params.selection;
					this.provider.setValue(this.state, true);
					break;

				case DidChangeGraphConfigurationNotification.is(msg):
					this.state.config = msg.params.config;
					this.provider.setValue(this.state, true);
					break;

				case DidChangeSubscriptionNotification.is(msg):
					this.state.subscription = msg.params.subscription;
					this.state.allowed = msg.params.allowed;
					this.provider.setValue(this.state, true);
					break;

				case DidChangeWorkingTreeNotification.is(msg):
					this.state.workingTreeStats = msg.params.stats;
					this.provider.setValue(this.state, true);
					break;

				case DidChangeRepoConnectionNotification.is(msg):
					this.state.repositories = msg.params.repositories;
					this.provider.setValue(this.state, true);
					break;
			}
		});
	}

	dispose() {
		this.disposable.dispose();
	}
}
