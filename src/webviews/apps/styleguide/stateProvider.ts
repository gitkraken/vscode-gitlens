import { ContextProvider } from '@lit/context';
import type { IpcMessage } from '../../ipc/models/ipc.js';
import type { State } from '../../styleguide/protocol.js';
import type { ReactiveElementHost } from '../shared/appHost.js';
import { StateProviderBase } from '../shared/stateProviderBase.js';
import { stateContext } from './context.js';

type StyleguideStateContext = typeof stateContext;

export class StyleguideStateProvider extends StateProviderBase<State['webviewId'], State, StyleguideStateContext> {
	protected override createContextProvider(
		state: State,
	): ContextProvider<StyleguideStateContext, ReactiveElementHost> {
		return new ContextProvider(this.host, { context: stateContext, initialValue: state });
	}

	protected override onMessageReceived(_msg: IpcMessage): void {
		// Static styleguide — no host messages.
	}
}
