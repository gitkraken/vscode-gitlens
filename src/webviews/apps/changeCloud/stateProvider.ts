import { ContextProvider } from '@lit/context';
import type { State } from '../../changeCloud/protocol';
import type { IpcMessage } from '../../protocol';
import type { ReactiveElementHost } from '../shared/appHost';
import { StateProviderBase } from '../shared/stateProviderBase';
import { stateContext } from './context';

export class ChangeCloudStateProvider extends StateProviderBase<State, typeof stateContext> {
	protected override createContextProvider(state: State): ContextProvider<typeof stateContext, ReactiveElementHost> {
		return new ContextProvider(this.host, { context: stateContext, initialValue: state });
	}

	protected override onMessageReceived(_msg: IpcMessage): void {}
}
