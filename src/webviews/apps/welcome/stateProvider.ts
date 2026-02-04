import { ContextProvider } from '@lit/context';
import type { IpcMessage } from '../../ipc/models/ipc.js';
import type { State } from '../../welcome/protocol.js';
import type { ReactiveElementHost } from '../shared/appHost.js';
import { StateProviderBase } from '../shared/stateProviderBase.js';
import { stateContext } from './context.js';

type WelcomeStateContext = typeof stateContext;

export class WelcomeStateProvider extends StateProviderBase<State['webviewId'], State, WelcomeStateContext> {
	protected override createContextProvider(state: State): ContextProvider<WelcomeStateContext, ReactiveElementHost> {
		return new ContextProvider(this.host, {
			context: stateContext,
			initialValue: state,
		});
	}

	protected override onMessageReceived(_msg: IpcMessage): void {
		// Welcome view has minimal state, no dynamic updates needed
	}
}
