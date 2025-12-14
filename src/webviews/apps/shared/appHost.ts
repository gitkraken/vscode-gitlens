import { provide } from '@lit/context';
import type { ReactiveControllerHost } from 'lit';
import { html, LitElement } from 'lit';
import { property } from 'lit/decorators.js';
import type { CustomEditorIds, WebviewIds, WebviewViewIds } from '../../../constants.views';
import type { Deferrable } from '../../../system/function/debounce';
import { debounce } from '../../../system/function/debounce';
import type { WebviewFocusChangedParams, WebviewState } from '../../protocol';
import {
	DidChangeWebviewFocusNotification,
	DidChangeWebviewVisibilityNotification,
	WebviewFocusChangedCommand,
} from '../../protocol';
import { GlElement } from './components/element';
import { ipcContext } from './contexts/ipc';
import { loggerContext, LoggerContext } from './contexts/logger';
import { promosContext, PromosContext } from './contexts/promos';
import { telemetryContext, TelemetryContext } from './contexts/telemetry';
import type { WebviewContext } from './contexts/webview';
import { webviewContext } from './contexts/webview';
import type { Disposable } from './events';
import { HostIpc } from './ipc';
import type { ThemeChangeEvent } from './theme';
import { computeThemeColors, onDidChangeTheme, watchThemeColors } from './theme';

export type ReactiveElementHost = ReactiveControllerHost & HTMLElement;

export interface StateProvider<State> extends Disposable {
	readonly state: State;
}

export abstract class GlAppHost<
	State extends WebviewState<CustomEditorIds | WebviewIds | WebviewViewIds> = WebviewState<
		CustomEditorIds | WebviewIds | WebviewViewIds
	>,
	Provider extends StateProvider<State> = StateProvider<State>,
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

	@provide({ context: promosContext })
	protected _promos!: PromosContext;

	@provide({ context: telemetryContext })
	protected _telemetry!: TelemetryContext;

	@provide({ context: webviewContext })
	protected _webview!: WebviewContext;

	@property({ type: String, noAccessor: true })
	private bootstrap!: string;
	protected onThemeUpdated?(e: ThemeChangeEvent): void;

	get state(): State {
		return this._stateProvider.state;
	}

	protected readonly disposables: Disposable[] = [];
	private _focused?: boolean;
	private _inputFocused?: boolean;
	private _sendWebviewFocusChangedCommandDebounced!: Deferrable<(params: WebviewFocusChangedParams) => void>;
	protected _stateProvider!: Provider;

	protected abstract createStateProvider(bootstrap: string, ipc: HostIpc, logger: LoggerContext): Provider;
	protected onWebviewFocusChanged?(focused: boolean): void;
	protected onWebviewVisibilityChanged?(visible: boolean): void;

	override connectedCallback(): void {
		super.connectedCallback?.();

		this._logger = new LoggerContext(this.name);
		this._logger.log('connected');

		this._ipc = new HostIpc(this.name);

		const bootstrap = this.bootstrap;
		this.bootstrap = undefined!;

		this._stateProvider = this.createStateProvider(bootstrap, this._ipc, this._logger);
		this._webview = {
			webviewId: this._stateProvider.state.webviewId,
			webviewInstanceId: this._stateProvider.state.webviewInstanceId,
		};

		const themeEvent = computeThemeColors();
		if (this.onThemeUpdated != null) {
			this.onThemeUpdated(themeEvent);
			this.disposables.push(watchThemeColors());
			this.disposables.push(onDidChangeTheme(this.onThemeUpdated, this));
		}

		this.disposables.push(
			this._stateProvider,
			this._ipc.onReceiveMessage(msg => {
				switch (true) {
					case DidChangeWebviewFocusNotification.is(msg):
						this.onWebviewFocusChanged?.(msg.params.focused);
						window.dispatchEvent(new CustomEvent(msg.params.focused ? 'webview-focus' : 'webview-blur'));
						break;
					case DidChangeWebviewVisibilityNotification.is(msg):
						this.onWebviewVisibilityChanged?.(msg.params.visible);
						window.dispatchEvent(
							new CustomEvent(msg.params.visible ? 'webview-visible' : 'webview-hidden'),
						);
						break;
				}
			}),
			this._ipc,
			(this._promos = new PromosContext(this._ipc)),
			(this._telemetry = new TelemetryContext(this._ipc)),
		);

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

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();

		this._logger.log('disconnected');

		document.removeEventListener('focusin', this.onFocusIn);
		document.removeEventListener('focusout', this.onFocusOut);
		this.disposables.forEach(d => d.dispose());
	}

	override render(): unknown {
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
