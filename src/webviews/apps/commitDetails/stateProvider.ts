import { ContextProvider } from '@lit/context';
import type { IpcSerialized } from '../../../system/ipcSerialize';
import type { State as _State, UpdateablePreferences } from '../../commitDetails/protocol';
import {
	ChangeReviewModeCommand,
	DidChangeDraftStateNotification,
	DidChangeHasAccountNotification,
	DidChangeIntegrationsNotification,
	DidChangeNotification,
	DidChangeWipStateNotification,
	SwitchModeCommand,
	UpdatePreferencesCommand,
} from '../../commitDetails/protocol';
import type { IpcMessage } from '../../protocol';
import type { ReactiveElementHost } from '../shared/appHost';
import { StateProviderBase } from '../shared/stateProviderBase';
import { stateContext } from './context';

type State = IpcSerialized<_State>;

export class CommitDetailsStateProvider extends StateProviderBase<State['webviewId'], State, typeof stateContext> {
	protected override get deferBootstrap(): boolean {
		return true;
	}

	protected override createContextProvider(state: State): ContextProvider<typeof stateContext, ReactiveElementHost> {
		return new ContextProvider(this.host, { context: stateContext, initialValue: state });
	}

	protected override onMessageReceived(msg: IpcMessage): void {
		switch (true) {
			case DidChangeNotification.is(msg):
				this._state = { ...(msg.params.state as State), timestamp: Date.now() };
				this.provider.setValue(this._state, true);
				this.host.requestUpdate();
				break;

			case DidChangeWipStateNotification.is(msg):
				this._state = { ...this._state, wip: msg.params.wip, inReview: msg.params.inReview };
				this.provider.setValue(this._state, true);
				this.host.requestUpdate();
				break;

			case DidChangeDraftStateNotification.is(msg):
				this.onDraftStateChanged(this.host, msg.params.inReview, true);
				break;

			case DidChangeHasAccountNotification.is(msg):
				this._state = { ...this._state, hasAccount: msg.params.hasAccount };
				this.provider.setValue(this._state, true);
				this.host.requestUpdate();
				break;

			case DidChangeIntegrationsNotification.is(msg):
				this._state = { ...this._state, hasIntegrationsConnected: msg.params.hasIntegrationsConnected };
				this.provider.setValue(this._state, true);
				this.host.requestUpdate();
				break;
		}
	}

	private onDraftStateChanged(host: ReactiveElementHost, inReview: boolean, silent = false) {
		if (inReview === this._state.inReview) return;
		this._state = { ...this._state, inReview: inReview };
		this.provider.setValue(this._state, true);
		host.requestUpdate();
		if (!silent) {
			this.ipc.sendCommand(ChangeReviewModeCommand, { inReview: inReview });
		}
	}

	switchMode(mode: State['mode']) {
		this._state = { ...this._state, mode: mode };
		this.provider.setValue(this._state, true);
		this.host.requestUpdate();

		this.ipc.sendCommand(SwitchModeCommand, { mode: mode, repoPath: this._state.commit?.repoPath });
	}

	updatePreferences(preferenceChange: UpdateablePreferences) {
		this._state = { ...this._state, preferences: { ...this._state.preferences, ...preferenceChange } };
		this.provider.setValue(this._state, true);
		this.host.requestUpdate();

		this.ipc.sendCommand(UpdatePreferencesCommand, preferenceChange);
	}
}
