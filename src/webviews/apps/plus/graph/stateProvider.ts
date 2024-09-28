import { ContextProvider } from '@lit/context';
import type { ReactiveControllerHost } from 'lit';
import type { State } from '../../graph/protocol';
import {
	DidChangeAvatarsNotification,
	DidChangeBranchStateNotification,
	DidChangeColumnsNotification,
	DidChangeGraphConfigurationNotification,
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
} from '../../graph/protocol';
import type { Disposable } from '../shared/events';
import type { HostIpc } from '../shared/ipc';
import { stateContext } from './context';

type ReactiveElementHost = Partial<ReactiveControllerHost> & HTMLElement;

export class GraphStateProvider implements Disposable {
	private readonly disposable: Disposable;
	private readonly provider: ContextProvider<{ __context__: State }, ReactiveElementHost>;
	private readonly state: State;

	constructor(
		host: ReactiveElementHost,
		state: State,
		private readonly _ipc: HostIpc,
	) {
		this.state = state;
		this.provider = new ContextProvider(host, { context: stateContext, initialValue: state });

		this.disposable = this._ipc.onReceiveMessage(msg => {
			switch (true) {
				case DidChangeRowsNotification.is(msg):
					this.state.rows = msg.params.rows;
					this.state.timestamp = Date.now();

					this.provider.setValue(this.state, true);
					break;
				case DidChangeAvatarsNotification.is(msg):
					this.state.avatars = msg.params.avatars;
					this.state.timestamp = Date.now();

					this.provider.setValue(this.state, true);
					break;
				case DidChangeBranchStateNotification.is(msg):
					this.state.branchState = msg.params.branchState;
					this.state.timestamp = Date.now();

					this.provider.setValue(this.state, true);
					break;
				case DidChangeColumnsNotification.is(msg):
					this.state.columns = msg.params.columns;
					this.state.timestamp = Date.now();

					this.provider.setValue(this.state, true);
					break;
				case DidChangeRefsVisibilityNotification.is(msg):
					this.state.branchesVisibility = msg.params.branchesVisibility;
					this.state.excludeRefs = msg.params.excludeRefs;
					this.state.excludeTypes = msg.params.excludeTypes;
					this.state.includeOnlyRefs = msg.params.includeOnlyRefs;
					this.state.timestamp = Date.now();

					this.provider.setValue(this.state, true);
					break;
				case DidChangeRefsMetadataNotification.is(msg):
					this.state.refsMetadata = msg.params.metadata;
					this.state.timestamp = Date.now();

					this.provider.setValue(this.state, true);
					break;
				case DidChangeRowsStatsNotification.is(msg):
					this.state.rowsStats = { ...this.state.rowsStats, ...msg.params.rowsStats };
					this.state.rowsStatsLoading = msg.params.rowsStatsLoading;
					this.state.timestamp = Date.now();

					this.provider.setValue(this.state, true);
					break;
				case DidChangeScrollMarkersNotification.is(msg):
					this.state.context = { ...this.state.context, settings: msg.params.context };
					this.state.timestamp = Date.now();

					this.provider.setValue(this.state, true);
					break;
				case DidSearchNotification.is(msg):
					this.state.searchResults = msg.params.results;
					if (msg.params.selectedRows != null) {
						this.state.selectedRows = msg.params.selectedRows;
					}
					this.state.timestamp = Date.now();

					this.provider.setValue(this.state, true);
					break;
				case DidChangeSelectionNotification.is(msg):
					this.state.selectedRows = msg.params.selection;
					this.state.timestamp = Date.now();

					this.provider.setValue(this.state, true);
					break;
				case DidChangeGraphConfigurationNotification.is(msg):
					this.state.config = msg.params.config;
					this.state.timestamp = Date.now();

					this.provider.setValue(this.state, true);
					break;
				case DidChangeSubscriptionNotification.is(msg):
					this.state.subscription = msg.params.subscription;
					this.state.allowed = msg.params.allowed;
					this.state.timestamp = Date.now();

					this.provider.setValue(this.state, true);
					break;
				case DidChangeWorkingTreeNotification.is(msg):
					this.state.workingTreeStats = msg.params.stats;
					this.state.timestamp = Date.now();

					this.provider.setValue(this.state, true);
					break;
				case DidChangeRepoConnectionNotification.is(msg):
					this.state.repositories = msg.params.repositories;
					this.state.timestamp = Date.now();

					this.provider.setValue(this.state, true);
					break;
				case DidFetchNotification.is(msg):
					this.state.lastFetched = msg.params.lastFetched;
					this.state.timestamp = Date.now();

					this.provider.setValue(this.state, true);
					break;
			}
		});
	}

	dispose() {
		this.disposable.dispose();
	}
}
