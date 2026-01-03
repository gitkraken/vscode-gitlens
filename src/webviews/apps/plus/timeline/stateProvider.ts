import { ContextProvider } from '@lit/context';
import type { IpcMessage } from '../../../ipc/models/ipc.js';
import type { State } from '../../../plus/timeline/protocol.js';
import { DidChangeNotification } from '../../../plus/timeline/protocol.js';
import type { ReactiveElementHost } from '../../shared/appHost.js';
import { StateProviderBase } from '../../shared/stateProviderBase.js';
import { stateContext } from './context.js';

export class TimelineStateProvider extends StateProviderBase<State['webviewId'], State, typeof stateContext> {
	protected override createContextProvider(state: State): ContextProvider<typeof stateContext, ReactiveElementHost> {
		return new ContextProvider(this.host, { context: stateContext, initialValue: state });
	}

	protected override onMessageReceived(msg: IpcMessage): void {
		switch (true) {
			case DidChangeNotification.is(msg):
				this._state = { ...msg.params.state, timestamp: Date.now() };

				this.provider.setValue(this._state, true);
				this.host.requestUpdate();
				break;
		}
	}

	protected override onPersistState(state: State): void {
		this.ipc.setPersistedState({ config: state.config, scope: state.scope });
	}
}
