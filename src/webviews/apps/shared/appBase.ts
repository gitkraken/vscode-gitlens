/*global window document*/
import { ContextProvider, provide } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { html, LitElement } from 'lit';
import { property } from 'lit/decorators.js';
import { fromBase64ToString } from '@gitlens/utils/base64.js';
import { debounce } from '@gitlens/utils/debounce.js';
import type { ScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { GlWebviewCommands } from '../../../constants.commands.js';
import type { CustomEditorIds, WebviewIds, WebviewTypes } from '../../../constants.views.js';
import { createWebviewCommandLink } from '../../../system/webview.js';
import type {
	IpcCallParamsType,
	IpcCallResponseParamsType,
	IpcCommand,
	IpcMessage,
	IpcRequest,
} from '../../ipc/models/ipc.js';
import type { WebviewFocusChangedParams, WebviewState } from '../../protocol.js';
import {
	DidChangeWebviewFocusNotification,
	DidChangeWebviewVisibilityNotification,
	WebviewFocusChangedCommand,
	WebviewReadyRequest,
} from '../../protocol.js';
import { GlElement } from './components/element.js';
import { ipcContext } from './contexts/ipc.js';
import { loggerContext, LoggerContext } from './contexts/logger.js';
import { PromosContext, promosContext } from './contexts/promos.js';
import { telemetryContext, TelemetryContext } from './contexts/telemetry.js';
import type { WebviewContext } from './contexts/webview.js';
import { webviewContext } from './contexts/webview.js';
import { DOM } from './dom.js';
import type { Disposable } from './events.js';
import { createFocusTracker } from './focus.js';
import type { HostIpcApi } from './ipc.js';
import { getHostIpcApi, HostIpc } from './ipc.js';
import { telemetryEventName } from './telemetry.js';
import type { ThemeChangeEvent } from './theme.js';
import { computeThemeColors, onDidChangeTheme, watchThemeColors } from './theme.js';

/**
 * Base class for webview applications (both legacy and RPC-based).
 *
 * Provides all shared infrastructure that webview apps need:
 * - 5 Lit context providers (ipc, logger, promos, telemetry, webview)
 * - Focus tracking (debounced notifications to host)
 * - Theme color computation and change handling
 * - Host→webview focus/visibility notification dispatch
 * - Preload class removal
 *
 * Subclasses initialize `this._webview` by calling `initWebviewContext()`
 * in their own `connectedCallback()` after `super.connectedCallback()`.
 *
 * Legacy webviews extend {@link GlAppHost} which extends this class.
 * New RPC webviews extend this class directly.
 */
export abstract class GlWebviewApp extends GlElement {
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

	protected onThemeUpdated?(e: ThemeChangeEvent): void;
	protected onWebviewFocusChanged?(focused: boolean): void;
	protected onWebviewVisibilityChanged?(visible: boolean): void;

	protected readonly disposables: Disposable[] = [];

	private _focusTracker?: ReturnType<typeof createFocusTracker>;

	/**
	 * Initializes `_webview` from a base64-encoded context string (the `#{state}` token value).
	 * Centralizes the `createCommandLink` logic used by all webviews.
	 *
	 * RPC webviews pass their `context` attribute; `GlAppHost` passes its `bootstrap` attribute.
	 */
	protected initWebviewContext(encodedContext: string): void {
		const parsed = JSON.parse(fromBase64ToString(encodedContext)) as WebviewState<WebviewIds>;
		const webviewId = parsed.webviewId;
		const webviewInstanceId = parsed.webviewInstanceId;
		this._webview = {
			webviewId: webviewId,
			webviewInstanceId: webviewInstanceId,
			createCommandLink: (command, args) => {
				if (command.endsWith(':')) {
					command = `${command}${webviewId.split('.').at(-1) as WebviewTypes}` as GlWebviewCommands;
				}
				return createWebviewCommandLink(command as GlWebviewCommands, webviewId, webviewInstanceId, args);
			},
		};
	}

	override connectedCallback(): void {
		super.connectedCallback?.();

		this._logger = new LoggerContext(this.name);
		this._logger.debug('connected');

		this._ipc = new HostIpc(this.name);

		const themeEvent = computeThemeColors();
		if (this.onThemeUpdated != null) {
			this.onThemeUpdated(themeEvent);
			this.disposables.push(watchThemeColors());
			this.disposables.push(onDidChangeTheme(this.onThemeUpdated, this));
		}

		this.disposables.push(
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

		// Focus tracking (sends debounced focus state to host for context keys)
		this._focusTracker = createFocusTracker();
		document.addEventListener('focusin', this._focusTracker.onFocusIn);
		document.addEventListener('focusout', this._focusTracker.onFocusOut);

		// Remove VS Code's default title attributes on <a> tags
		document.querySelectorAll('a').forEach(a => {
			if (a.href === a.title) {
				a.removeAttribute('title');
			}
		});

		// Remove preload class after delay to enable CSS transitions
		if (document.body.classList.contains('preload')) {
			setTimeout(() => {
				document.body.classList.remove('preload');
			}, 500);
		}
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();

		this._logger.debug('disconnected');

		if (this._focusTracker != null) {
			document.removeEventListener('focusin', this._focusTracker.onFocusIn);
			document.removeEventListener('focusout', this._focusTracker.onFocusOut);
			this._focusTracker = undefined;
		}

		this.disposables.forEach(d => d.dispose());
	}

	override render(): unknown {
		return html`<slot></slot>`;
	}
}

// SignalWatcher mixin loses parent class type information (known TS issue with mixins).
// `GlWebviewApp` is abstract, so we first cast to a concrete constructor for `SignalWatcher`,
// then cast the result back to preserve `GlWebviewApp`'s type surface.
const _SignalWatcherBase = SignalWatcher(
	GlWebviewApp as unknown as new (...args: any[]) => GlWebviewApp,
) as unknown as typeof GlWebviewApp;

/**
 * Base class for RPC-only webviews that use Lit Signals for state management.
 * Sends `WebviewReadyRequest` at the end of `connectedCallback()` — this is
 * the unified readiness signal that triggers IPC notification flush and RPC expose().
 */
export abstract class SignalWatcherWebviewApp extends _SignalWatcherBase {
	override connectedCallback(): void {
		super.connectedCallback?.();

		// Signal readiness to the host — triggers IPC flush and RPC expose()
		void this._ipc.sendRequest(WebviewReadyRequest, { bootstrap: false });
	}
}

/** @deprecated Use GlAppHost or GlWebviewApp instead */
export abstract class App<
	State extends WebviewState<CustomEditorIds | WebviewIds> = WebviewState<CustomEditorIds | WebviewIds>,
> {
	private readonly _api: HostIpcApi;
	private readonly _hostIpc: HostIpc;
	private readonly _logger: LoggerContext;
	private readonly _promos: PromosContext;
	protected readonly _telemetry: TelemetryContext;
	private readonly _webview: WebviewContext;

	protected state: State;
	protected readonly placement: 'editor' | 'view';

	constructor(protected readonly appName: string) {
		const disposables: Disposable[] = [];

		const themeEvent = computeThemeColors();
		if (this.onThemeUpdated != null) {
			this.onThemeUpdated(themeEvent);
			disposables.push(onDidChangeTheme(this.onThemeUpdated, this));
		}

		this.state = (window as any).bootstrap;
		(window as any).bootstrap = undefined;

		this.placement = (document.body.getAttribute('data-placement') ?? 'editor') as 'editor' | 'view';

		this._logger = new LoggerContext(appName);
		this.log('opening...');

		this._api = getHostIpcApi();
		this._hostIpc = new HostIpc(this.appName);
		disposables.push(this._hostIpc);

		this._promos = new PromosContext(this._hostIpc);
		disposables.push(this._promos);

		this._telemetry = new TelemetryContext(this._hostIpc);
		disposables.push(this._telemetry);

		const { webviewId, webviewInstanceId } = this.state;
		this._webview = {
			webviewId: webviewId,
			webviewInstanceId: webviewInstanceId,
			createCommandLink: (command, args) => {
				if (command.endsWith(':')) {
					command = `${command}${webviewId.split('.').at(-1) as WebviewTypes}` as GlWebviewCommands;
				}

				return createWebviewCommandLink(command as GlWebviewCommands, webviewId, webviewInstanceId, args);
			},
		};

		new ContextProvider(document.body, { context: ipcContext, initialValue: this._hostIpc });
		new ContextProvider(document.body, { context: loggerContext, initialValue: this._logger });
		new ContextProvider(document.body, { context: promosContext, initialValue: this._promos });
		new ContextProvider(document.body, { context: telemetryContext, initialValue: this._telemetry });
		new ContextProvider(document.body, { context: webviewContext, initialValue: this._webview });

		if (this.state != null) {
			const state = this.getState();
			if (this.state.timestamp >= (state?.timestamp ?? 0)) {
				this._api.setState(this.state);
			} else {
				this.state = state!;
			}
		}

		disposables.push(watchThemeColors());

		requestAnimationFrame(() => {
			this.log('initializing...');

			try {
				this.onInitialize?.();
				this.bind();

				if (this.onMessageReceived != null) {
					disposables.push(
						this._hostIpc.onReceiveMessage(msg => {
							switch (true) {
								case DidChangeWebviewFocusNotification.is(msg):
									window.dispatchEvent(
										new CustomEvent(msg.params.focused ? 'webview-focus' : 'webview-blur'),
									);
									break;

								case DidChangeWebviewVisibilityNotification.is(msg):
									window.dispatchEvent(
										new CustomEvent(msg.params.visible ? 'webview-visible' : 'webview-hidden'),
									);
									break;

								default:
									this.onMessageReceived!(msg);
							}
						}),
					);
				}

				void this.sendRequest(WebviewReadyRequest, { bootstrap: false });

				this.onInitialized?.();
			} finally {
				this.log('initialized');
				if (document.body.classList.contains('preload')) {
					setTimeout(() => {
						document.body.classList.remove('preload');
					}, 500);
				}
			}
		});

		disposables.push(
			DOM.on(window, 'pagehide', () => {
				disposables?.forEach(d => d.dispose());
				this.bindDisposables?.forEach(d => d.dispose());
				this.bindDisposables = undefined;
			}),
		);

		disposables.push(
			DOM.on(window, telemetryEventName, e => {
				this._telemetry.sendEvent(e.detail);
			}),
		);

		this.log('opened');
	}

	protected onInitialize?(): void;
	protected onBind?(): Disposable[];
	protected onInitialized?(): void;
	protected onMessageReceived?(msg: IpcMessage): void;
	protected onThemeUpdated?(e: ThemeChangeEvent): void;

	private _focused?: boolean;
	private _inputFocused?: boolean;

	private bindDisposables: Disposable[] | undefined;
	protected bind(): void {
		document.querySelectorAll('a').forEach(a => {
			if (a.href === a.title) {
				a.removeAttribute('title');
			}
		});

		this.bindDisposables?.forEach(d => d.dispose());
		this.bindDisposables = this.onBind?.();
		this.bindDisposables ??= [];

		// Reduces event jankiness when only moving focus
		const sendWebviewFocusChangedCommand = debounce((params: WebviewFocusChangedParams) => {
			this.sendCommand(WebviewFocusChangedCommand, params);
		}, 150);

		this.bindDisposables.push(
			DOM.on(document, 'focusin', e => {
				const inputFocused = e.composedPath().some(el => (el as HTMLElement).tagName === 'INPUT');

				if (this._focused !== true || this._inputFocused !== inputFocused) {
					this._focused = true;
					this._inputFocused = inputFocused;
					sendWebviewFocusChangedCommand({ focused: true, inputFocused: inputFocused });
				}
			}),
			DOM.on(document, 'focusout', () => {
				if (this._focused !== false || this._inputFocused !== false) {
					this._focused = false;
					this._inputFocused = false;
					sendWebviewFocusChangedCommand({ focused: false, inputFocused: false });
				}
			}),
		);
	}

	protected log(message: string, ...optionalParams: any[]): void;
	protected log(scope: ScopedLogger | undefined, message: string, ...optionalParams: any[]): void;
	protected log(scopeOrMessage: ScopedLogger | string | undefined, ...optionalParams: any[]): void {
		this._logger.debug(scopeOrMessage, ...optionalParams);
	}

	protected getState(): State | undefined {
		return this._api.getState() as State | undefined;
	}

	protected sendCommand<TCommand extends IpcCommand<any>>(
		command: TCommand,
		params: IpcCallParamsType<TCommand>,
	): void {
		this._hostIpc.sendCommand(command, params);
	}

	protected sendRequest<T extends IpcRequest<unknown, unknown>>(
		requestType: T,
		params: IpcCallParamsType<T>,
	): Promise<IpcCallResponseParamsType<T>> {
		return this._hostIpc.sendRequest(requestType, params);
	}

	protected setState(state: Partial<State>): void {
		this._api.setState(state);
	}
}
