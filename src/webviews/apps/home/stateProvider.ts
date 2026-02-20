import { ContextProvider } from '@lit/context';
import type { State } from '../../home/protocol.js';
import {
	DidChangeAiAllAccessBanner,
	DidChangeIntegrationsConnections,
	DidChangeMcpBanner,
	DidChangeOrgSettings,
	DidChangePreviewEnabled,
	DidChangeRepositories,
	DidChangeSubscription,
	DidChangeWalkthroughProgress,
	DidCompleteDiscoveringRepositories,
} from '../../home/protocol.js';
import type { IpcMessage } from '../../ipc/models/ipc.js';
import type { ReactiveElementHost } from '../shared/appHost.js';
import { StateProviderBase } from '../shared/stateProviderBase.js';
import { stateContext } from './context.js';

export class HomeStateProvider extends StateProviderBase<State['webviewId'], State, typeof stateContext> {
	protected override createContextProvider(state: State): ContextProvider<typeof stateContext, ReactiveElementHost> {
		return new ContextProvider(this.host, { context: stateContext, initialValue: state });
	}

	protected override onMessageReceived(msg: IpcMessage): void {
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
				this._state.ai = msg.params.ai;
				this._state.timestamp = Date.now();

				this.provider.setValue(this._state, true);
				break;

			case DidChangePreviewEnabled.is(msg):
				this._state.previewEnabled = msg.params.previewEnabled;
				this._state.aiEnabled = msg.params.aiEnabled;
				this._state.experimentalComposerEnabled = msg.params.experimentalComposerEnabled;
				this._state.timestamp = Date.now();

				this.provider.setValue(this._state, true);
				this.host.requestUpdate();
				break;

			case DidChangeAiAllAccessBanner.is(msg):
				this._state.aiAllAccessBannerCollapsed = msg.params;
				this._state.timestamp = Date.now();

				this.provider.setValue(this._state, true);
				this.host.requestUpdate();
				break;
			case DidChangeMcpBanner.is(msg):
				this._state.mcpBannerCollapsed = msg.params.mcpBannerCollapsed;
				this._state.mcpCanAutoRegister = msg.params.mcpCanAutoRegister;
				this._state.timestamp = Date.now();

				this.provider.setValue(this._state, true);
				this.host.requestUpdate();
				break;
		}
	}
}
