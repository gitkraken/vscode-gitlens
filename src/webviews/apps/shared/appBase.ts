/*global window document*/
import {
	IpcCommandType,
	IpcMessage,
	IpcMessageParams,
	IpcNotificationType,
	onIpc,
	WebviewReadyCommandType,
} from '../../protocol';
import { DOM } from './dom';
import { Disposable } from './events';
import { initializeAndWatchThemeColors } from './theme';

interface VsCodeApi {
	postMessage(msg: unknown): void;
	setState(state: unknown): void;
	getState(): unknown;
}

declare function acquireVsCodeApi(): VsCodeApi;

let ipcSequence = 0;
function nextIpcId() {
	if (ipcSequence === Number.MAX_SAFE_INTEGER) {
		ipcSequence = 1;
	} else {
		ipcSequence++;
	}

	return `webview:${ipcSequence}`;
}

export abstract class App<State = void> {
	private readonly _api: VsCodeApi;
	protected state: State;

	constructor(protected readonly appName: string) {
		this.log(`${this.appName}.ctor`);

		this.state = (window as any).bootstrap;
		(window as any).bootstrap = undefined;

		this._api = acquireVsCodeApi();
		initializeAndWatchThemeColors();

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

	private bindDisposables: Disposable[] | undefined;
	protected bind() {
		this.bindDisposables?.forEach(d => d.dispose());
		this.bindDisposables = this.onBind?.();
	}

	protected log(message: string) {
		console.log(message);
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
