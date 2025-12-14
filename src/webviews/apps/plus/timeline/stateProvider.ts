import { ContextProvider } from '@lit/context';
import type { State } from '../../../plus/timeline/protocol';
import { DidChangeNotification } from '../../../plus/timeline/protocol';
import type { IpcMessage } from '../../../protocol';
import type { ReactiveElementHost } from '../../shared/appHost';
import { StateProviderBase } from '../../shared/stateProviderBase';
import { stateContext } from './context';

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
