'use strict';
/*global window document*/
import { Disposable } from 'vscode';
import { IpcCommandParamsOf, IpcCommandType, IpcMessage, ReadyCommandType } from '../../protocol';
import { initializeAndWatchThemeColors } from './theme';

interface VsCodeApi {
	postMessage(msg: object): void;
	setState(state: object): void;
	getState(): object;
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

export abstract class App<State extends object> {
	private readonly _api: VsCodeApi;
	protected state: State;

	constructor(protected readonly appName: string, state: State) {
		this.log(`${this.appName}.ctor`);

		this._api = acquireVsCodeApi();
		initializeAndWatchThemeColors();

		this.state = state;
		setTimeout(() => {
			this.log(`${this.appName}.initializing`);

			this.onInitialize?.();
			this.bind();

			if (this.onMessageReceived != null) {
				window.addEventListener('message', this.onMessageReceived.bind(this));
			}

			this.sendCommand(ReadyCommandType, {});

			this.onInitialized?.();

			setTimeout(() => {
				document.body.classList.remove('preload');
			}, 500);
		}, 0);
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

	protected sendCommand<CT extends IpcCommandType>(type: CT, params: IpcCommandParamsOf<CT>): void {
		return this.postMessage({ id: nextIpcId(), method: type.method, params: params });
	}

	protected setState(state: State) {
		this.state = state;
		this._api.setState(state);
	}

	private postMessage(e: IpcMessage) {
		this._api.postMessage(e);
	}
}
