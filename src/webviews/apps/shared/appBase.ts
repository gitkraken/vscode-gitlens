/*global window document*/
import { ContextProvider } from '@lit/context';
import type { GlWebviewCommands } from '../../../constants.commands.js';
import type { CustomEditorIds, WebviewIds, WebviewTypes } from '../../../constants.views.js';
import { debounce } from '../../../system/function/debounce.js';
import type { ScopedLogger } from '../../../system/logger.scope.js';
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
import { ipcContext } from './contexts/ipc.js';
import { loggerContext, LoggerContext } from './contexts/logger.js';
import { PromosContext, promosContext } from './contexts/promos.js';
import { telemetryContext, TelemetryContext } from './contexts/telemetry.js';
import type { WebviewContext } from './contexts/webview.js';
import { webviewContext } from './contexts/webview.js';
import { DOM } from './dom.js';
import type { Disposable } from './events.js';
import type { HostIpcApi } from './ipc.js';
import { getHostIpcApi, HostIpc } from './ipc.js';
import { telemetryEventName } from './telemetry.js';
import type { ThemeChangeEvent } from './theme.js';
import { computeThemeColors, onDidChangeTheme, watchThemeColors } from './theme.js';

/** @deprecated Use GlAppHost instead */
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
