/*global window document*/
import { debounce } from '../../../system/function';
import { Logger } from '../../../system/logger';
import { LogLevel } from '../../../system/logger.constants';
import type {
	IpcCommandType,
	IpcMessage,
	IpcMessageParams,
	IpcNotificationType,
	WebviewFocusChangedParams,
} from '../../protocol';
import { onIpc, WebviewFocusChangedCommandType, WebviewReadyCommandType } from '../../protocol';
import { DOM } from './dom';
import type { Disposable } from './events';
import type { ThemeChangeEvent } from './theme';
import { initializeAndWatchThemeColors, onDidChangeTheme } from './theme';

declare const DEBUG: boolean;

interface VsCodeApi {
	postMessage(msg: unknown): void;
	setState(state: unknown): void;
	getState(): unknown;
}

declare function acquireVsCodeApi(): VsCodeApi;

const maxSmallIntegerV8 = 2 ** 30; // Max number that can be stored in V8's smis (small integers)

let ipcSequence = 0;
function nextIpcId() {
	if (ipcSequence === maxSmallIntegerV8) {
		ipcSequence = 1;
	} else {
		ipcSequence++;
	}

	return `webview:${ipcSequence}`;
}

export abstract class App<State = undefined> {
	private readonly _api: VsCodeApi;
	protected state: State;

	constructor(protected readonly appName: string) {
		this.state = (window as any).bootstrap;
		(window as any).bootstrap = undefined;

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
			DEBUG ? LogLevel.Debug : LogLevel.Off,
		);

		this.log(`ctor()`);
		// this.log(`ctor(${this.state ? JSON.stringify(this.state) : ''})`);

		this._api = acquireVsCodeApi();

		const disposables: Disposable[] = [];

		if (this.onThemeUpdated != null) {
			disposables.push(onDidChangeTheme(this.onThemeUpdated, this));
		}
		disposables.push(initializeAndWatchThemeColors());

		requestAnimationFrame(() => {
			this.log(`ctor(): initializing...`);

			try {
				this.onInitialize?.();
				this.bind();

				if (this.onMessageReceived != null) {
					disposables.push(DOM.on(window, 'message', this.onMessageReceived.bind(this)));
				}

				this.sendCommand(WebviewReadyCommandType, undefined);

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
	protected onMessageReceived?(e: MessageEvent): void;
	protected onThemeUpdated?(e: ThemeChangeEvent): void;

	private _focused?: boolean;
	private _inputFocused?: boolean;

	private bindDisposables: Disposable[] | undefined;
	protected bind() {
		this.bindDisposables?.forEach(d => d.dispose());
		this.bindDisposables = this.onBind?.();
		if (this.bindDisposables == null) {
			this.bindDisposables = [];
		}

		// Reduces event jankiness when only moving focus
		const sendWebviewFocusChangedCommand = debounce((params: WebviewFocusChangedParams) => {
			this.sendCommand(WebviewFocusChangedCommandType, params);
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

	protected log(message: string, ...optionalParams: any[]) {
		Logger.log(message, ...optionalParams);
	}

	protected getState(): State {
		return this._api.getState() as State;
	}

	protected sendCommand<TCommand extends IpcCommandType<any>>(
		command: TCommand,
		params: IpcMessageParams<TCommand>,
	): void {
		const id = nextIpcId();
		this.log(`sendCommand(${id}): name=${command.method}`);

		this.postMessage({ id: id, method: command.method, params: params });
	}

	protected async sendCommandWithCompletion<
		TCommand extends IpcCommandType<any>,
		TCompletion extends IpcNotificationType<any>,
	>(
		command: TCommand,
		params: IpcMessageParams<TCommand>,
		completion: TCompletion,
	): Promise<IpcMessageParams<TCompletion>> {
		const id = nextIpcId();
		this.log(`sendCommandWithCompletion(${id}): name=${command.method}`);

		const promise = new Promise<IpcMessageParams<TCompletion>>((resolve, reject) => {
			let timeout: ReturnType<typeof setTimeout> | undefined;

			const disposables = [
				DOM.on(window, 'message', (e: MessageEvent<IpcMessage>) => {
					onIpc(completion, e.data, params => {
						if (e.data.completionId === id) {
							disposables.forEach(d => d.dispose());
							queueMicrotask(() => resolve(params));
						}
					});
				}),
				{
					dispose: function () {
						if (timeout != null) {
							clearTimeout(timeout);
							timeout = undefined;
						}
					},
				},
			];

			timeout = setTimeout(() => {
				timeout = undefined;
				disposables.forEach(d => d.dispose());
				debugger;
				reject(new Error(`Timed out waiting for completion of ${completion.method}`));
			}, 60000);
		});

		this.postMessage({ id: id, method: command.method, params: params, completionId: id });
		return promise;
	}

	protected setState(state: State) {
		this.state = state;
		if (state == null) return;

		this._api.setState(state);
	}

	private postMessage(e: IpcMessage) {
		this._api.postMessage(e);
	}
}
