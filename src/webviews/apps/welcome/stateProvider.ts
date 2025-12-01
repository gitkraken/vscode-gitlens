import { ContextProvider } from '@lit/context';
import type { IpcMessage } from '../../protocol';
import type { State } from '../../welcome/protocol';
import type { ReactiveElementHost } from '../shared/appHost';
import { StateProviderBase } from '../shared/stateProviderBase';
import { stateContext } from './context';

export class WelcomeStateProvider extends StateProviderBase<State['webviewId'], State, typeof stateContext> {
	protected override createContextProvider(state: State): ContextProvider<typeof stateContext, ReactiveElementHost> {
		return new ContextProvider(this.host, { context: stateContext, initialValue: state });
	}

	protected override onMessageReceived(_msg: IpcMessage): void {
		// Welcome webview doesn't need to handle any messages
	}
}
