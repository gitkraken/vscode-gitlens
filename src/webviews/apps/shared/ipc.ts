/*global window */
import { getScopedCounter } from '../../../system/counter';
import { debug, logName } from '../../../system/decorators/log';
import { Logger } from '../../../system/logger';
import { getLogScope, getNewLogScope } from '../../../system/logger.scope';
import { maybeStopWatch } from '../../../system/stopwatch';
import type { Serialized } from '../../../system/vscode/serialize';
import type { IpcCallParamsType, IpcCallResponseParamsType, IpcCommand, IpcMessage, IpcRequest } from '../../protocol';
import { ipcPromiseSettled, isIpcPromise } from '../../protocol';
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

const ipcSequencer = getScopedCounter();
function nextIpcId() {
	return `webview:${ipcSequencer.next()}`;
}

type PendingHandler = (msg: IpcMessage) => void;

@logName<HostIpc>((c, name) => `${c.appName}(${name})`)
export class HostIpc implements Disposable {
	private _onReceiveMessage = new Emitter<IpcMessage>();
	get onReceiveMessage(): Event<IpcMessage> {
		return this._onReceiveMessage.event;
	}

	private readonly _api: HostIpcApi;
	private readonly _disposable: Disposable;
	private _pendingHandlers = new Map<string, PendingHandler>();
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

		this.replaceIpcPromisesWithPromises(msg.params);

		// If we have a completionId, then this is a response to a request and it should be handled directly
		if (msg.completionId != null) {
			const queueKey = getQueueKey(msg.method, msg.completionId);
			this._pendingHandlers.get(queueKey)?.(msg);

			return;
		}

		this._onReceiveMessage.fire(msg);
	}

	replaceIpcPromisesWithPromises(data: unknown) {
		if (data == null || typeof data !== 'object') return;

		for (const key in data) {
			const value = (data as Record<string, unknown>)[key];
			if (isIpcPromise(value)) {
				(data as Record<string, unknown>)[key] = this.getResponsePromise(value.method, value.id);
			} else {
				this.replaceIpcPromisesWithPromises(value);
			}
		}
	}

	sendCommand<T extends IpcCommand>(commandType: T, params?: never): void;
	sendCommand<T extends IpcCommand<unknown>>(commandType: T, params: IpcCallParamsType<T>): void;
	@debug<HostIpc['sendCommand']>({ args: { 0: c => c.method, 1: false } })
	sendCommand<T extends IpcCommand | IpcCommand<unknown>>(commandType: T, params?: IpcCallParamsType<T>): void {
		const id = nextIpcId();
		// this.log(`${this.appName}.sendCommand(${id}): name=${command.method}`);

		this.postMessage({
			id: id,
			scope: commandType.scope,
			method: commandType.method,
			params: params,
		} satisfies IpcMessage<IpcCallParamsType<T>>);
	}

	@debug<HostIpc['sendRequest']>({ args: { 0: c => c.method, 1: false, 2: false } })
	async sendRequest<T extends IpcRequest<unknown, unknown>>(
		requestType: T,
		params: IpcCallParamsType<T>,
	): Promise<IpcCallResponseParamsType<T>> {
		const id = nextIpcId();
		// this.log(`${this.appName}.sendCommandWithCompletion(${id}): name=${command.method}`);

		const promise = this.getResponsePromise(requestType.response.method, id);
		this.postMessage({
			id: id,
			scope: requestType.scope,
			method: requestType.method,
			params: params,
			completionId: id,
		} satisfies IpcMessage<IpcCallParamsType<T>>);
		return promise;
	}

	private getResponsePromise<T extends IpcRequest<unknown, unknown>>(method: string, id: string) {
		const promise = new Promise<IpcCallResponseParamsType<T>>((resolve, reject) => {
			const queueKey = getQueueKey(method, id);
			let timeout: ReturnType<typeof setTimeout> | undefined;

			function dispose(this: HostIpc) {
				clearTimeout(timeout);
				timeout = undefined;
				this._pendingHandlers.delete(queueKey);
			}

			timeout = setTimeout(
				() => {
					dispose.call(this);
					debugger;
					reject(new Error(`Timed out waiting for completion of ${queueKey}`));
				},
				(Logger.isDebugging ? 60 : 5) * 60 * 1000,
			);

			this._pendingHandlers.set(queueKey, msg => {
				dispose.call(this);

				if (msg.method === ipcPromiseSettled.method) {
					const params = msg.params as PromiseSettledResult<unknown>;
					if (params.status === 'rejected') {
						queueMicrotask(() => reject(new Error(params.reason)));
					} else {
						queueMicrotask(() => resolve(params.value));
					}
				} else {
					queueMicrotask(() => resolve(msg.params));
				}
			});
		});
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

function getQueueKey(method: string, id: string) {
	return `${method}|${id}`;
}
