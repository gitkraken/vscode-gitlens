import { ContextProvider } from '@lit/context';
import type { State } from '../../../plus/timeline/protocol';
import { DidChangeNotification } from '../../../plus/timeline/protocol';
import type { ReactiveElementHost, StateProvider } from '../../shared/app';
import type { Disposable } from '../../shared/events';
import type { HostIpc } from '../../shared/ipc';
import { stateContext } from './context';

export class TimelineStateProvider implements StateProvider<State> {
	private readonly disposable: Disposable;
	private readonly provider: ContextProvider<{ __context__: State }, ReactiveElementHost>;

	private _state: State;
	get state(): State {
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
				case DidChangeNotification.is(msg):
					this._state = { ...msg.params.state, timestamp: Date.now() };

					this.provider.setValue(this._state, true);
					host.requestUpdate();
					break;
			}
		});
	}

	dispose(): void {
		this.disposable.dispose();
	}
}
