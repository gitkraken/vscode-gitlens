import type { ReactiveControllerHost } from 'lit';
import { property } from 'lit/decorators.js';
import type { CustomEditorIds, WebviewIds } from '../../../constants.views.js';
import type { WebviewState } from '../../protocol.js';
import { GlWebviewApp } from './appBase.js';
import type { LoggerContext } from './contexts/logger.js';
import type { Disposable } from './events.js';
import type { HostIpc } from './ipc.js';

export type ReactiveElementHost = ReactiveControllerHost & HTMLElement;

export interface StateProvider<State> extends Disposable {
	readonly state: State;
}

export abstract class GlAppHost<
	State extends WebviewState<CustomEditorIds | WebviewIds> = WebviewState<CustomEditorIds | WebviewIds>,
	Provider extends StateProvider<State> = StateProvider<State>,
> extends GlWebviewApp {
	@property({ type: String, noAccessor: true })
	private bootstrap!: string;

	get state(): State {
		return this._stateProvider.state;
	}

	protected _stateProvider!: Provider;

	protected abstract createStateProvider(bootstrap: string, ipc: HostIpc, logger: LoggerContext): Provider;

	override connectedCallback(): void {
		super.connectedCallback();

		const bootstrap = this.consumeOneShotAttribute(this.bootstrap);
		this.bootstrap = undefined!;

		// Recreated per mount: the provider permanently captures this mount's `HostIpc` (created
		// fresh in `super.connectedCallback` and disposed per disconnect) and its constructor issues
		// the `WebviewReadyRequest` that triggers the host's RPC expose — reusing a prior mount's
		// provider would leave it bound to a dead transport and never re-signal ready. KNOWN
		// TRADEOFF: each startup-churn remount registers another Lit context provider on this host
		// (nothing detaches them); bounded to the few pre-session churn mounts, and each old
		// provider itself is disposed below.
		this._stateProvider = this.createStateProvider(bootstrap, this._ipc, this._logger);
		this.initWebviewContext(bootstrap);

		this.disposables.push(this._stateProvider);
	}
}
