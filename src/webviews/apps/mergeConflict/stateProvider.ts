import { ContextProvider } from '@lit/context';
import type { IpcSerialized } from '../../../system/ipcSerialize.js';
import type { IpcMessage } from '../../ipc/models/ipc.js';
import type { State as _State, MergeConflictResolution } from '../../mergeConflict/protocol.js';
import { DidChangeStateNotification, DidResolveNotification } from '../../mergeConflict/protocol.js';
import type { ReactiveElementHost } from '../shared/appHost.js';
import { StateProviderBase } from '../shared/stateProviderBase.js';
import { stateContext } from './context.js';

type State = IpcSerialized<_State>;

export class MergeConflictStateProvider extends StateProviderBase<State['webviewId'], State, typeof stateContext> {
	protected override get deferBootstrap(): boolean {
		return false;
	}

	protected override createContextProvider(state: State): ContextProvider<typeof stateContext, ReactiveElementHost> {
		return new ContextProvider(this.host, { context: stateContext, initialValue: state });
	}

	protected override onMessageReceived(msg: IpcMessage): void {
		switch (true) {
			case DidChangeStateNotification.is(msg):
				this._state = { ...msg.params.state, timestamp: Date.now() };
				this.provider.setValue(this._state, true);
				this.host.requestUpdate();
				break;

			case DidResolveNotification.is(msg):
				this.applyResolution(msg.params.resolution);
				break;
		}
	}

	/**
	 * Folds a single-hunk resolution into existing state without waiting for a full DidChange.
	 * Keeps the Output pane responsive when the host emits a per-hunk update before the trailing
	 * state notification arrives.
	 */
	private applyResolution(resolution: MergeConflictResolution): void {
		if (this._state == null) return;

		const next = this._state.resolutions.map(r => (r.hunkIndex === resolution.hunkIndex ? resolution : r));
		this._state = { ...this._state, resolutions: next, timestamp: Date.now() };
		this.provider.setValue(this._state, true);
		this.host.requestUpdate();
	}
}
