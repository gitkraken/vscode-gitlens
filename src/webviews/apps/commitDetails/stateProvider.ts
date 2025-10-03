import { ContextProvider } from '@lit/context';
import type { Serialized } from '../../../system/serialize';
import type { State, UpdateablePreferences } from '../../commitDetails/protocol';
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
import type { ReactiveElementHost, StateProvider } from '../shared/appHost';
import type { Disposable } from '../shared/events';
import type { HostIpc } from '../shared/ipc';
import { assertsSerialized } from '../shared/ipc';
import { stateContext } from './context';

export class CommitDetailsStateProvider implements StateProvider<Serialized<State>> {
	private readonly disposable: Disposable;
	private readonly provider: ContextProvider<{ __context__: Serialized<State> }, ReactiveElementHost>;

	private _state: Serialized<State>;
	get state(): Serialized<State> {
		return this._state;
	}

	private _host: ReactiveElementHost;

	constructor(
		host: ReactiveElementHost,
		state: Serialized<State>,
		private readonly _ipc: HostIpc,
	) {
		this._host = host;
		this._state = state;
		this.provider = new ContextProvider(host, { context: stateContext, initialValue: state });

		this.disposable = this._ipc.onReceiveMessage(msg => {
			switch (true) {
				// case DidChangeRichStateNotificationType.method:
				// 	onIpc(DidChangeRichStateNotificationType, msg, params => {
				// 		if (this._state.selected == null) return;

				// 		assertsSerialized<typeof params>(params);

				// 		const newState = { ...this._state };
				// 		if (params.formattedMessage != null) {
				// 			newState.selected!.message = params.formattedMessage;
				// 		}
				// 		// if (params.pullRequest != null) {
				// 		newState.pullRequest = params.pullRequest;
				// 		// }
				// 		// if (params.formattedMessage != null) {
				// 		newState.autolinkedIssues = params.autolinkedIssues;
				// 		// }

				// 		this._state = newState;
				// 		this.provider.setValue(this._state, true);

				// 		this.renderRichContent();
				// 	});
				// 	break;

				case DidChangeNotification.is(msg):
					assertsSerialized<State>(msg.params.state);

					this._state = { ...msg.params.state, timestamp: Date.now() };
					this.provider.setValue(this._state, true);
					host.requestUpdate();
					break;

				case DidChangeWipStateNotification.is(msg):
					this._state = { ...this._state, wip: msg.params.wip, inReview: msg.params.inReview };
					this.provider.setValue(this._state, true);
					host.requestUpdate();
					break;

				case DidChangeDraftStateNotification.is(msg):
					this.onDraftStateChanged(host, msg.params.inReview, true);
					break;

				case DidChangeHasAccountNotification.is(msg):
					this._state = { ...this._state, hasAccount: msg.params.hasAccount };
					this.provider.setValue(this._state, true);
					host.requestUpdate();
					break;

				case DidChangeIntegrationsNotification.is(msg):
					this._state = { ...this._state, hasIntegrationsConnected: msg.params.hasIntegrationsConnected };
					this.provider.setValue(this._state, true);
					host.requestUpdate();
					break;
			}
		});
	}

	dispose(): void {
		this.disposable.dispose();
	}

	private onDraftStateChanged(host: ReactiveElementHost, inReview: boolean, silent = false) {
		if (inReview === this._state.inReview) return;
		this._state = { ...this._state, inReview: inReview };
		this.provider.setValue(this._state, true);
		host.requestUpdate();
		if (!silent) {
			this._ipc.sendCommand(ChangeReviewModeCommand, { inReview: inReview });
		}
	}

	switchMode(mode: State['mode']) {
		this._state = { ...this._state, mode: mode };
		this.provider.setValue(this._state, true);
		this._host.requestUpdate();

		this._ipc.sendCommand(SwitchModeCommand, { mode: mode, repoPath: this._state.commit?.repoPath });
	}

	updatePreferences(preferenceChange: UpdateablePreferences) {
		this._state = { ...this._state, preferences: { ...this._state.preferences, ...preferenceChange } };
		this.provider.setValue(this._state, true);
		this._host.requestUpdate();

		this._ipc.sendCommand(UpdatePreferencesCommand, preferenceChange);
	}
}
