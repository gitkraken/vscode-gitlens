import type { Context, ContextProvider, ContextType } from '@lit/context';
import { fromBase64ToString } from '@env/base64';
import type { CustomEditorIds, WebviewIds, WebviewViewIds } from '../../../constants.views';
import { isPromise } from '../../../system/promise';
import type { IpcMessage, WebviewState } from '../../protocol';
import { WebviewReadyRequest } from '../../protocol';
import type { ReactiveElementHost } from './appHost';
import type { LoggerContext } from './contexts/logger';
import type { Disposable } from './events';
import type { HostIpc } from './ipc';

/**
 * Base class for webview state providers that handles bootstrap initialization.
 *
 * Subclasses declare their bootstrap strategy ('sync' or 'async') and implement
 * message handling. The base class automatically handles state initialization:
 * - Sync: Uses bootstrap state from HTML
 * - Async: Requests full state from extension after connection
 */
export abstract class StateProviderBase<
	ID extends WebviewIds | WebviewViewIds | CustomEditorIds,
	State extends WebviewState<ID>,
	TContext extends Context<unknown, State>,
> implements Disposable {
	protected readonly disposable: Disposable;
	protected readonly provider: ContextProvider<TContext, ReactiveElementHost>;

	protected _state: State;
	get state(): State {
		return this._state;
	}

	get webviewId() {
		return this._state.webviewId;
	}

	get webviewInstanceId() {
		return this._state.webviewInstanceId;
	}

	get timestamp() {
		return this._state.timestamp;
	}

	constructor(
		protected host: ReactiveElementHost,
		bootstrap: string,
		protected ipc: HostIpc,
		protected logger: LoggerContext,
	) {
		// Deserialize bootstrap from base64
		this._state = this.ipc.deserializeIpcData<State>(fromBase64ToString(bootstrap));
		this.logger?.log(`bootstrap duration=${Date.now() - this._state.timestamp}ms`);

		this.provider = this.createContextProvider(this._state);
		this.onPersistState?.(this._state);

		this.disposable = this.ipc.onReceiveMessage(this.onMessageReceived.bind(this));
		void this.initializeState();
	}

	dispose(): void {
		this.disposable.dispose();
	}

	protected get deferBootstrap(): boolean {
		return false;
	}

	protected abstract createContextProvider(state: State): ContextProvider<any, ReactiveElementHost>;

	protected async initializeState(): Promise<void> {
		if (this.deferBootstrap) {
			const response = await this.ipc.sendRequest(WebviewReadyRequest, { bootstrap: true });
			if (response.state != null) {
				const state: State = (isPromise(response.state) ? await response.state : response.state) as State;
				this.onDeferredBootstrapStateReceived(state);
			}
		} else {
			void this.ipc.sendRequest(WebviewReadyRequest, { bootstrap: false });
		}
	}

	protected onDeferredBootstrapStateReceived(state: State): void {
		this._state = { ...state, timestamp: Date.now() };
		this.provider.setValue(this._state as ContextType<TContext>, true);
		this.host.requestUpdate();
	}

	protected abstract onMessageReceived(msg: IpcMessage): void;
	protected onPersistState?(state: State): void;
}
