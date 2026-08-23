import type { Context, ContextProvider, ContextType } from '@lit/context';
import { fromBase64ToString } from '@gitlens/utils/base64.js';
import { isPromise } from '@gitlens/utils/promise.js';
import type { WebviewIds } from '../../../constants.views.js';
import type { IpcMessage } from '../../ipc/models/ipc.js';
import type { WebviewState } from '../../protocol.js';
import { WebviewReadyRequest } from '../../protocol.js';
import type { ReactiveElementHost } from './appHost.js';
import type { LoggerContext } from './contexts/logger.js';
import type { Disposable } from './events.js';
import type { HostIpc } from './ipc.js';
import { getWebviewClientInfo } from './ipc.js';

/**
 * Base class for webview state providers that handles bootstrap initialization.
 *
 * Subclasses declare their bootstrap strategy ('sync' or 'async') and implement
 * message handling. The base class automatically handles state initialization:
 * - Sync: Uses bootstrap state from HTML
 * - Async: Requests full state from extension after connection
 */
export abstract class StateProviderBase<
	ID extends WebviewIds,
	State extends WebviewState<ID>,
	TContext extends Context<unknown, State>,
> implements Disposable {
	protected readonly disposable: Disposable;
	protected readonly provider: ContextProvider<TContext, ReactiveElementHost>;

	protected _state: State;
	/** The bootstrap state snapshot. Providers that keep all live values in signal accessors (e.g. the
	 *  graph's) stop mirroring into this after construction, so here it serves only identity getters
	 *  (`webviewId`/`webviewInstanceId`/`timestamp`) and one-time seeding; providers without accessors
	 *  (rebase/welcome/allowedSigners) still treat it as their live store. */
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
		this.logger?.debug(`bootstrap duration=${Date.now() - this._state.timestamp}ms`);

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
		const client = getWebviewClientInfo();
		if (this.deferBootstrap) {
			const response = await this.ipc.sendRequest(WebviewReadyRequest, { bootstrap: true, ...client });
			if (response.state != null) {
				const state: State = (isPromise(response.state) ? await response.state : response.state) as State;
				this.onDeferredBootstrapStateReceived(state);
			}
		} else {
			void this.ipc.sendRequest(WebviewReadyRequest, { bootstrap: false, ...client });
		}
	}

	/**
	 * NOTE: replaces `_state` wholesale WITHOUT syncing subclass signal accessors — any provider that
	 * opts into `deferBootstrap` must re-seed its accessors here (or override this), or they'll keep
	 * serving bootstrap values. Latent trap: no current subclass defers, but the graph's accessor-based
	 * provider would silently desync if it ever adopted it.
	 */
	protected onDeferredBootstrapStateReceived(state: State): void {
		this._state = { ...state, timestamp: Date.now() };
		this.provider.setValue(this._state as ContextType<TContext>, true);
		this.host.requestUpdate();
	}

	protected abstract onMessageReceived(msg: IpcMessage): void;
	protected onPersistState?(state: State): void;
}
