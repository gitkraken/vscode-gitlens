/*global window document*/
import type { IpcCommandType, IpcMessage, IpcMessageParams, IpcNotificationType } from '../../protocol';
import { onIpc, WebviewReadyCommandType } from '../../protocol';
import { DOM } from './dom';
import type { Disposable } from './events';
import { initializeAndWatchThemeColors } from './theme';

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

		this.log(`${this.appName}()`);
		// this.log(`${this.appName}(${this.state ? JSON.stringify(this.state) : ''})`);

		this._api = acquireVsCodeApi();
		initializeAndWatchThemeColors(this.onThemeUpdated?.bind(this));

		requestAnimationFrame(() => {
			this.log(`${this.appName}.initializing`);

			try {
				this.onInitialize?.();
				this.bind();

				if (this.onMessageReceived != null) {
					window.addEventListener('message', this.onMessageReceived.bind(this));
				}

				this.sendCommand(WebviewReadyCommandType, undefined);

				this.onInitialized?.();
			} finally {
				setTimeout(() => {
					document.body.classList.remove('preload');
				}, 500);
			}
		});
	}

	protected onInitialize?(): void;
	protected onBind?(): Disposable[];
	protected onInitialized?(): void;
	protected onMessageReceived?(e: MessageEvent): void;
	protected onThemeUpdated?(): void;

	private bindDisposables: Disposable[] | undefined;
	protected bind() {
		this.bindDisposables?.forEach(d => d.dispose());
		this.bindDisposables = this.onBind?.();
	}

	protected log(message: string, ...optionalParams: any[]) {
		console.log(message, ...optionalParams);
	}

	protected getState(): State {
		return this._api.getState() as State;
	}

	protected sendCommand<TCommand extends IpcCommandType<any>>(
		command: TCommand,
		params: IpcMessageParams<TCommand>,
	): void {
		const id = nextIpcId();
		this.log(`${this.appName}.sendCommand(${id}): name=${command.method}`);

		return this.postMessage({ id: id, method: command.method, params: params });
	}

	protected sendCommandWithCompletion<
		TCommand extends IpcCommandType<any>,
		TCompletion extends IpcNotificationType<{ completionId: string }>,
	>(
		command: TCommand,
		params: IpcMessageParams<TCommand>,
		completion: TCompletion,
		callback: (params: IpcMessageParams<TCompletion>) => void,
	): void {
		const id = nextIpcId();
		this.log(`${this.appName}.sendCommandWithCompletion(${id}): name=${command.method}`);

		const disposable = DOM.on(window, 'message', e => {
			onIpc(completion, e.data as IpcMessage, params => {
				if (params.completionId === id) {
					disposable.dispose();
					callback(params);
				}
			});
		});

		return this.postMessage({ id: id, method: command.method, params: params });
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
