import { ContextProvider } from '@lit/context';
import type { ReactiveControllerHost } from 'lit';
import type { State } from '../../home/protocol';
import {
	DidChangeIntegrationsConnections,
	DidChangeOrgSettings,
	DidChangePreviewEnabled,
	DidChangeRepositories,
	DidChangeSubscription,
	DidChangeWalkthroughProgress,
	DidCompleteDiscoveringRepositories,
} from '../../home/protocol';
import type { StateProvider } from '../shared/app';
import type { Disposable } from '../shared/events';
import type { HostIpc } from '../shared/ipc';
import { stateContext } from './context';

type ReactiveElementHost = Partial<ReactiveControllerHost> & HTMLElement;

export class HomeStateProvider implements StateProvider<State> {
	private readonly disposable: Disposable;
	private readonly provider: ContextProvider<{ __context__: State }, ReactiveElementHost>;

	private readonly _state: State;
	get state() {
		return this._state;
	}

	constructor(
		host: ReactiveElementHost,
		state: State,
		private readonly _ipc: HostIpc,
	) {
		this._state = state;
		this.provider = new ContextProvider(host, { context: stateContext, initialValue: state });

		this.disposable = this._ipc.onReceiveMessage(msg => {
			switch (true) {
				case DidChangeRepositories.is(msg):
					this._state.repositories = msg.params;
					this._state.timestamp = Date.now();

					this.provider.setValue(this._state, true);
					break;
				case DidCompleteDiscoveringRepositories.is(msg):
					this._state.repositories = msg.params.repositories;
					this._state.discovering = msg.params.discovering;
					this._state.timestamp = Date.now();

					this.provider.setValue(this._state, true);
					break;
				case DidChangeWalkthroughProgress.is(msg):
					this._state.walkthroughProgress = msg.params;
					this._state.timestamp = Date.now();

					this.provider.setValue(this._state, true);
					break;
				case DidChangeSubscription.is(msg):
					this._state.subscription = msg.params.subscription;
					this._state.avatar = msg.params.avatar;
					this._state.organizationsCount = msg.params.organizationsCount;
					this._state.timestamp = Date.now();

					this.provider.setValue(this._state, true);
					break;
				case DidChangeOrgSettings.is(msg):
					this._state.orgSettings = msg.params.orgSettings;
					this._state.timestamp = Date.now();

					this.provider.setValue(this._state, true);
					break;

				case DidChangeIntegrationsConnections.is(msg):
					this._state.hasAnyIntegrationConnected = msg.params.hasAnyIntegrationConnected;
					this._state.integrations = msg.params.integrations;
					this._state.timestamp = Date.now();

					this.provider.setValue(this._state, true);
					break;

				case DidChangePreviewEnabled.is(msg):
					this._state.previewEnabled = msg.params.previewEnabled;
					this._state.previewCollapsed = msg.params.previewCollapsed;
					this._state.timestamp = Date.now();

					this.provider.setValue(this._state, true);
					host.requestUpdate?.();
					break;
			}
		});
	}

	dispose() {
		this.disposable.dispose();
	}
}
