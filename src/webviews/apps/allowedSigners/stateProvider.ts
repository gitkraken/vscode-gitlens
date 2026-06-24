import { ContextProvider } from '@lit/context';
import type { State } from '../../allowedSigners/protocol.js';
import { DidChangeProgressNotification, DidChangeResultsNotification } from '../../allowedSigners/protocol.js';
import type { IpcMessage } from '../../ipc/models/ipc.js';
import type { ReactiveElementHost } from '../shared/appHost.js';
import { StateProviderBase } from '../shared/stateProviderBase.js';
import { stateContext } from './context.js';

type AllowedSignersStateContext = typeof stateContext;

export class AllowedSignersStateProvider extends StateProviderBase<
	State['webviewId'],
	State,
	AllowedSignersStateContext
> {
	protected override createContextProvider(
		state: State,
	): ContextProvider<AllowedSignersStateContext, ReactiveElementHost> {
		return new ContextProvider(this.host, { context: stateContext, initialValue: state });
	}

	protected override onMessageReceived(msg: IpcMessage): void {
		switch (true) {
			case DidChangeProgressNotification.is(msg):
				this._state.progress = msg.params.progress;
				break;

			case DidChangeResultsNotification.is(msg):
				this._state.signers = msg.params.signers;
				this._state.integrationConnected = msg.params.integrationConnected;
				this._state.verifying = msg.params.verifying;
				this._state.error = msg.params.error;
				this._state.loading = false;
				this._state.progress = undefined;
				break;

			default:
				return;
		}

		this._state.timestamp = Date.now();
		this.provider.setValue(this._state, true);
		// The app renders from `this.state` directly (it's not a context consumer), so force it to re-render.
		this.host.requestUpdate();
	}
}
