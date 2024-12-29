import { provide } from '@lit/context';
import { html, LitElement } from 'lit';
import { property } from 'lit/decorators.js';
import type { CustomEditorIds, WebviewIds, WebviewViewIds } from '../../../constants.views';
import type { Deferrable } from '../../../system/function';
import { debounce } from '../../../system/function';
import type { WebviewFocusChangedParams } from '../../protocol';
import { DidChangeWebviewFocusNotification, WebviewFocusChangedCommand, WebviewReadyCommand } from '../../protocol';
import { GlElement } from './components/element';
import { ipcContext, LoggerContext, loggerContext, telemetryContext, TelemetryContext } from './context';
import type { Disposable } from './events';
import { HostIpc } from './ipc';

export interface StateProvider<State> extends Disposable {
	readonly state: State;
	// readonly signal?: ReturnType<typeof signal<State>>;
}

export abstract class GlApp<
	State extends { webviewId: CustomEditorIds | WebviewIds | WebviewViewIds; timestamp: number } = {
		webviewId: CustomEditorIds | WebviewIds | WebviewViewIds;
		timestamp: number;
	},
> extends GlElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	@property({ type: String }) name!: string;
	@property({ type: String }) placement: 'editor' | 'view' = 'editor';

	@provide({ context: ipcContext })
	protected _ipc!: HostIpc;

	@provide({ context: loggerContext })
	protected _logger!: LoggerContext;

	@provide({ context: telemetryContext })
	protected _telemetry!: TelemetryContext;

	@property({ type: Object, noAccessor: true })
	private bootstrap!: State;

	get state() {
		return this._stateProvider.state;
	}

	protected readonly disposables: Disposable[] = [];
	private _focused?: boolean;
	private _inputFocused?: boolean;
	private _sendWebviewFocusChangedCommandDebounced!: Deferrable<(params: WebviewFocusChangedParams) => void>;
	private _stateProvider!: StateProvider<State>;

	protected abstract createStateProvider(state: State, ipc: HostIpc): StateProvider<State>;

	override connectedCallback() {
		super.connectedCallback();

		this._logger = new LoggerContext(this.name);
		this._logger.log('connected');

		this._ipc = new HostIpc(this.name);

		const state = this.bootstrap;
		this.bootstrap = undefined!;
		this._ipc.replaceIpcPromisesWithPromises(state);

		this.disposables.push(
			(this._stateProvider = this.createStateProvider(state, this._ipc)),
			this._ipc.onReceiveMessage(msg => {
				switch (true) {
					case DidChangeWebviewFocusNotification.is(msg):
						window.dispatchEvent(new CustomEvent(msg.params.focused ? 'webview-focus' : 'webview-blur'));
						break;
				}
			}),
			this._ipc,
			(this._telemetry = new TelemetryContext(this._ipc)),
		);
		this._ipc.sendCommand(WebviewReadyCommand, undefined);

		this._sendWebviewFocusChangedCommandDebounced = debounce((params: WebviewFocusChangedParams) => {
			this._ipc.sendCommand(WebviewFocusChangedCommand, params);
		}, 150);

		// Removes VS Code's default title attributes on <a> tags
		document.querySelectorAll('a').forEach(a => {
			if (a.href === a.title) {
				a.removeAttribute('title');
			}
		});

		document.addEventListener('focusin', this.onFocusIn);
		document.addEventListener('focusout', this.onFocusOut);

		if (document.body.classList.contains('preload')) {
			setTimeout(() => {
				document.body.classList.remove('preload');
			}, 500);
		}
	}

	override disconnectedCallback() {
		super.disconnectedCallback();

		this._logger.log('disconnected');

		document.removeEventListener('focusin', this.onFocusIn);
		document.removeEventListener('focusout', this.onFocusOut);
		this.disposables.forEach(d => d.dispose());
	}

	override render() {
		return html`<slot></slot>`;
	}

	private onFocusIn = (e: FocusEvent) => {
		const inputFocused = e.composedPath().some(el => (el as HTMLElement).tagName === 'INPUT');

		if (this._focused !== true || this._inputFocused !== inputFocused) {
			this._focused = true;
			this._inputFocused = inputFocused;
			this._sendWebviewFocusChangedCommandDebounced({ focused: true, inputFocused: inputFocused });
		}
	};

	private onFocusOut = (_e: FocusEvent) => {
		if (this._focused !== false || this._inputFocused !== false) {
			this._focused = false;
			this._inputFocused = false;
			this._sendWebviewFocusChangedCommandDebounced({ focused: false, inputFocused: false });
		}
	};
}
