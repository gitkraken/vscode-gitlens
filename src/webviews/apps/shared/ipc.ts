/*global window */
import { inflateSync, strFromU8 } from 'fflate';
import { getScopedCounter } from '../../../system/counter';
import { debug, logName } from '../../../system/decorators/log';
import { deserializeIpcData } from '../../../system/ipcSerialize';
import { Logger } from '../../../system/logger';
import { getLogScope, getNewLogScope, setLogScopeExit } from '../../../system/logger.scope';
import type { Serialized } from '../../../system/serialize';
import { maybeStopWatch } from '../../../system/stopwatch';
import type { IpcCallParamsType, IpcCallResponseParamsType, IpcCommand, IpcMessage, IpcRequest } from '../../protocol';
import { IpcPromiseSettled } from '../../protocol';
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
export function getHostIpcApi(): HostIpcApi {
	return (_api ??= acquireVsCodeApi());
}

const ipcSequencer = getScopedCounter();
function nextIpcId() {
	return `webview:${ipcSequencer.next()}`;
}

type PendingHandler = (msg: IpcMessage) => void;

@logName<HostIpc>(c => `${c.appName}(HostIpc)`)
export class HostIpc implements Disposable {
	private _onReceiveMessage = new Emitter<IpcMessage>();
	get onReceiveMessage(): Event<IpcMessage> {
		return this._onReceiveMessage.event;
	}

	private readonly _api: HostIpcApi;
	private readonly _disposable: Disposable;
	private _pendingHandlers = new Map<string, PendingHandler>();

	constructor(private readonly appName: string) {
		this._api = getHostIpcApi();
		this._disposable = DOM.on(window, 'message', e => this.onMessageReceived(e));
	}

	dispose(): void {
		this._disposable.dispose();
	}

	@debug<HostIpc['onMessageReceived']>({ args: { 0: e => `${e.data.id}|${e.data.method}` } })
	private onMessageReceived(e: MessageEvent) {
		const scope = getLogScope();

		const msg = e.data as IpcMessage;
		const sw = maybeStopWatch(getNewLogScope(`(e=${msg.id}|${msg.method})`, scope), {
			log: false,
			logLevel: 'debug',
		});

		if (msg.compressed && msg.params instanceof Uint8Array) {
			if (msg.compressed === 'deflate') {
				try {
					msg.params = strFromU8(inflateSync(msg.params));
				} catch (ex) {
					debugger;
					console.warn('IPC deflate decompression failed, assuming uncompressed', ex);
					msg.params = strFromU8(msg.params as Uint8Array);
				}
			} else {
				msg.params = strFromU8(msg.params);
			}
			sw?.restart({ message: `\u2022 decompressed (${msg.compressed}) serialized params` });
		}

		if (typeof msg.params === 'string') {
			msg.params = deserializeIpcData(msg.params, v => this.getResponsePromise(v.method, v.id));
			sw?.stop({ message: `\u2022 deserialized params` });
		} else if (msg.params == null) {
			sw?.stop({ message: `\u2022 no params` });
		} else {
			sw?.stop({ message: `\u2022 invalid params` });
			debugger;
		}

		setLogScopeExit(scope, ` \u2022 ipc (host -> webview) duration=${Date.now() - msg.timestamp}ms`);

		// If we have a completionId, then this is a response to a request and it should be handled directly
		if (msg.completionId != null) {
			const queueKey = getQueueKey(msg.method, msg.completionId);
			this._pendingHandlers.get(queueKey)?.(msg);

			return;
		}

		this._onReceiveMessage.fire(msg);
	}

	deserializeIpcData<T>(data: string): T {
		return deserializeIpcData<T>(data, v => this.getResponsePromise(v.method, v.id));
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
			compressed: false,
			timestamp: Date.now(),
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
			compressed: false,
			timestamp: Date.now(),
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

				if (msg.method === IpcPromiseSettled.method) {
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

	setPersistedState<T>(state: Partial<T>): void {
		this._api.setState(state);
	}

	updatePersistedState<T>(update: Partial<T>): void {
		let state = this._api.getState() as Partial<T> | undefined;
		if (state != null && typeof state === 'object') {
			state = { ...state, ...update };
			this._api.setState(state);
		} else {
			state = update;
		}
		this.setPersistedState(state);
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
