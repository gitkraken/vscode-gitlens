/*global window document*/
import type { CustomEditorIds, WebviewIds, WebviewViewIds } from '../../../constants';
import { debounce } from '../../../system/function';
import { Logger } from '../../../system/logger';
import type { LogScope } from '../../../system/logger.scope';
import type {
	IpcCallParamsType,
	IpcCallResponseParamsType,
	IpcCommand,
	IpcMessage,
	IpcRequest,
	WebviewFocusChangedParams,
} from '../../protocol';
import { DidChangeWebviewFocusNotfication, WebviewFocusChangedCommand, WebviewReadyCommand } from '../../protocol';
import { DOM } from './dom';
import type { Disposable } from './events';
import type { HostIpcApi } from './ipc';
import { getHostIpcApi, HostIpc } from './ipc';
import type { ThemeChangeEvent } from './theme';
import { computeThemeColors, onDidChangeTheme, watchThemeColors } from './theme';

declare const DEBUG: boolean;

export abstract class App<
	State extends { webviewId: CustomEditorIds | WebviewIds | WebviewViewIds; timestamp: number } = {
		webviewId: CustomEditorIds | WebviewIds | WebviewViewIds;
		timestamp: number;
	},
> {
	private readonly _api: HostIpcApi;
	private readonly _hostIpc: HostIpc;

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

		Logger.configure(
			{
				name: appName,
				createChannel: function (name: string) {
					return {
						name: name,
						appendLine: function (value: string) {
							console.log(`[${name}] ${value}`);
						},
					};
				},
			},
			DEBUG ? 'debug' : 'off',
		);

		this.log(`${appName}()`);
		// this.log(`ctor(${this.state ? JSON.stringify(this.state) : ''})`);

		this._api = getHostIpcApi();
		this._hostIpc = new HostIpc(this.appName);
		disposables.push(this._hostIpc);

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
			this.log(`${appName}(): initializing...`);

			try {
				this.onInitialize?.();
				this.bind();

				if (this.onMessageReceived != null) {
					disposables.push(
						this._hostIpc.onReceiveMessage(msg => {
							switch (true) {
								case DidChangeWebviewFocusNotfication.is(msg):
									window.dispatchEvent(
										new CustomEvent(msg.params.focused ? 'webview-focus' : 'webview-blur'),
									);
									break;

								default:
									this.onMessageReceived!(msg);
							}
						}),
					);
				}

				this.sendCommand(WebviewReadyCommand, undefined);

				this.onInitialized?.();
			} finally {
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
	}

	protected onInitialize?(): void;
	protected onBind?(): Disposable[];
	protected onInitialized?(): void;
	protected onMessageReceived?(msg: IpcMessage): void;
	protected onThemeUpdated?(e: ThemeChangeEvent): void;

	private _focused?: boolean;
	private _inputFocused?: boolean;

	private bindDisposables: Disposable[] | undefined;
	protected bind() {
		document.querySelectorAll('a').forEach(a => {
			if (a.href === a.title) {
				a.removeAttribute('title');
			}
		});

		this.bindDisposables?.forEach(d => d.dispose());
		this.bindDisposables = this.onBind?.();
		if (this.bindDisposables == null) {
			this.bindDisposables = [];
		}

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
	protected log(scope: LogScope | undefined, message: string, ...optionalParams: any[]): void;
	protected log(scopeOrMessage: LogScope | string | undefined, ...optionalParams: any[]): void {
		if (typeof scopeOrMessage === 'string') {
			Logger.log(scopeOrMessage, ...optionalParams);
		} else {
			Logger.log(scopeOrMessage, optionalParams.shift(), ...optionalParams);
		}
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

	protected setState(state: Partial<State>) {
		this._api.setState(state);
	}
}
