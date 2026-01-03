import type { CustomEditorTypes, WebviewTypes, WebviewViewTypes } from '../../../constants.views.js';

type IpcCompression = 'deflate' | 'utf8' | false;
export type IpcScope = 'core' | CustomEditorTypes | WebviewTypes | WebviewViewTypes;

export interface IpcMessage<T = unknown> {
	id: string;
	scope: IpcScope;
	method: string;
	params: T;
	compressed: IpcCompression;
	timestamp: number;

	completionId?: string;
}

abstract class IpcCall<Params> {
	public readonly method: string;

	constructor(
		public readonly scope: IpcScope,
		method: string,
		public readonly reset: boolean = false,
	) {
		this.method = `${scope}/${method}`;
	}

	is(msg: IpcMessage): msg is IpcMessage<Params> {
		return msg.method === this.method;
	}
}

/** Extracts the message type from an IpcCommand or IpcRequest */
export type IpcCallMessageType<T> = T extends IpcCall<infer P> ? IpcMessage<P> : never;

/** Extracts the params type from an IpcCommand or IpcRequest */
export type IpcCallParamsType<T> = IpcCallMessageType<T>['params'];

/** Extracts the response type from an IpcRequest */
export type IpcCallResponseType<T> = T extends IpcRequest<infer _, infer _> ? T['response'] : never;
/** Extracts the response message type from an IpcRequest */
export type IpcCallResponseMessageType<T> = IpcCallMessageType<IpcCallResponseType<T>>;
/** Extracts the response params type from an IpcRequest */
export type IpcCallResponseParamsType<T> = IpcCallResponseMessageType<T>['params'];

/** Commands are sent from the webview to the extension */
export class IpcCommand<Params = void> extends IpcCall<Params> {}

/** Requests are sent from the webview to the extension and expect a response back */
export class IpcRequest<Params = void, ResponseParams = void> extends IpcCall<Params> {
	public readonly response: IpcNotification<ResponseParams>;

	constructor(scope: IpcScope, method: string, reset?: boolean) {
		super(scope, method, reset);

		this.response = new IpcNotification<ResponseParams>(this.scope, `${method}/completion`, this.reset);
	}
}

/** Notifications are sent from the extension to the webview */
export class IpcNotification<Params = void> extends IpcCall<Params> {}
