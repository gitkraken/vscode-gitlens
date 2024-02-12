/*global window */
import { debug, logName } from '../../../system/decorators/log';
import { getLogScope, getNewLogScope } from '../../../system/logger.scope';
import type { Serialized } from '../../../system/serialize';
import { maybeStopWatch } from '../../../system/stopwatch';
import type { IpcCommandType, IpcMessage, IpcMessageParams, IpcNotificationType } from '../../protocol';
import { onIpc } from '../../protocol';
import { DOM } from './dom';
import type { Disposable, Event } from './events';
import { Emitter } from './events';

export interface HostIpcApi {
	postMessage(msg: unknown): void;
	setState(state: unknown): void;
	getState(): unknown;
}

declare function acquireVsCodeApi(): HostIpcApi;

let _api: HostIpcApi | undefined;
export function getHostIpcApi() {
	return (_api ??= acquireVsCodeApi());
}

const maxSmallIntegerV8 = 2 ** 30; // Max number that can be stored in V8's smis (small integers)

let ipcSequence = 0;
export function nextIpcId() {
	if (ipcSequence === maxSmallIntegerV8) {
		ipcSequence = 1;
	} else {
		ipcSequence++;
	}

	return `webview:${ipcSequence}`;
}

@logName<HostIpc>((c, name) => `${c.appName}(${name})`)
export class HostIpc implements Disposable {
	private _onReceiveMessage = new Emitter<IpcMessage>();
	get onReceiveMessage(): Event<IpcMessage> {
		return this._onReceiveMessage.event;
	}

	private readonly _api: HostIpcApi;
	private readonly _disposable: Disposable;
	private _textDecoder: TextDecoder | undefined;

	constructor(private readonly appName: string) {
		this._api = getHostIpcApi();
		this._disposable = DOM.on(window, 'message', e => this.onMessageReceived(e));
	}

	dispose() {
		this._disposable.dispose();
	}

	@debug<HostIpc['onMessageReceived']>({ args: { 0: e => `${e.data.id}, method=${e.data.method}` } })
	private onMessageReceived(e: MessageEvent) {
		const scope = getLogScope();

		const msg = e.data as IpcMessage;
		if (msg.packed && msg.params instanceof Uint8Array) {
			const sw = maybeStopWatch(getNewLogScope(` deserializing msg=${e.data.method}`, scope), {
				log: false,
				logLevel: 'debug',
			});
			this._textDecoder ??= new TextDecoder();
			msg.params = JSON.parse(this._textDecoder.decode(msg.params));
			sw?.stop();
		}

		this._onReceiveMessage.fire(msg);
	}

	@debug<HostIpc['sendCommand']>({ args: { 0: c => c.method, 1: false } })
	sendCommand<TCommand extends IpcCommandType<any>>(command: TCommand, params: IpcMessageParams<TCommand>): void {
		const id = nextIpcId();
		// this.log(`${this.appName}.sendCommand(${id}): name=${command.method}`);

		this.postMessage({ id: id, method: command.method, params: params });
	}

	@debug<HostIpc['sendCommandWithCompletion']>({ args: { 0: c => c.method, 1: false, 2: false } })
	async sendCommandWithCompletion<TCommand extends IpcCommandType<any>, TCompletion extends IpcNotificationType<any>>(
		command: TCommand,
		params: IpcMessageParams<TCommand>,
		completion: TCompletion,
	): Promise<IpcMessageParams<TCompletion>> {
		const id = nextIpcId();
		// this.log(`${this.appName}.sendCommandWithCompletion(${id}): name=${command.method}`);

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

	setState<T>(state: Partial<T>) {
		this._api.setState(state);
	}

	@debug<HostIpc['postMessage']>({ args: { 0: e => `${e.id}, method=${e.method}` } })
	private postMessage(e: IpcMessage) {
		this._api.postMessage(e);
	}
}

export function assertsSerialized<T>(obj: unknown): asserts obj is Serialized<T> {}
