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
import type { Disposable } from '../shared/events';
import type { HostIpc } from '../shared/ipc';
import { stateContext } from './context';

type ReactiveElementHost = Partial<ReactiveControllerHost> & HTMLElement;

export class HomeStateProvider implements Disposable {
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
				case DidChangeRepositories.is(msg):
					this.state.repositories = msg.params;
					this.state.timestamp = Date.now();

					this.provider.setValue(this.state, true);
					break;
				case DidCompleteDiscoveringRepositories.is(msg):
					this.state.repositories = msg.params.repositories;
					this.state.discovering = msg.params.discovering;
					this.state.timestamp = Date.now();

					this.provider.setValue(this.state, true);
					break;
				case DidChangeWalkthroughProgress.is(msg):
					this.state.walkthroughProgress = msg.params;
					this.state.timestamp = Date.now();

					this.provider.setValue(this.state, true);
					break;
				case DidChangeSubscription.is(msg):
					this.state.subscription = msg.params.subscription;
					this.state.avatar = msg.params.avatar;
					this.state.organizationsCount = msg.params.organizationsCount;
					this.state.timestamp = Date.now();

					this.provider.setValue(this.state, true);
					break;
				case DidChangeOrgSettings.is(msg):
					this.state.orgSettings = msg.params.orgSettings;
					this.state.timestamp = Date.now();

					this.provider.setValue(this.state, true);
					break;

				case DidChangeIntegrationsConnections.is(msg):
					this.state.hasAnyIntegrationConnected = msg.params.hasAnyIntegrationConnected;
					this.state.timestamp = Date.now();

					this.provider.setValue(this.state, true);
					break;

				case DidChangePreviewEnabled.is(msg):
					this.state.previewEnabled = msg.params.previewEnabled;
					this.state.previewCollapsed = msg.params.previewCollapsed;
					this.state.timestamp = Date.now();

					this.provider.setValue(this.state, true);
					host.requestUpdate?.();
					break;
			}
		});
	}

	dispose() {
		this.disposable.dispose();
	}
}
