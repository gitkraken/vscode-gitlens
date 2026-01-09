import type { WebviewHost } from '../webviewProvider.js';
import type { IpcCallParamsType, IpcCallResponseParamsType, IpcCommand, IpcMessage, IpcRequest } from './models/ipc.js';

/** Extracts the params type from an IpcCommand or IpcRequest */
export type IpcParams<T extends IpcCommand<any> | IpcRequest<any, any>> = IpcCallParamsType<T>;

/** Extracts the response type from an IpcRequest */
export type IpcResponse<T extends IpcRequest<any, any>> = IpcCallResponseParamsType<T>;

/** Stores handler metadata per class constructor */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
const ipcHandlerRegistry = new WeakMap<Function, Map<string, IpcHandlerEntry>>();

type IpcHandlerType = 'command' | 'request';

/** Metadata stored for each @ipc decorated method */
interface IpcHandlerEntry {
	/** The full method string (e.g., 'commitDetails/file/open') */
	method: string;
	/** The property key of the decorated method */
	propertyKey: string | symbol;
	/** The type of handler */
	type: IpcHandlerType;
	/** For request handlers, the request type to use for responding */
	requestType?: IpcRequest<unknown, unknown>;
}

/** Union type for message types that can be handled */
type IpcMessageType = IpcCommand<any> | IpcRequest<any, any>;

function registerHandler(
	target: object,
	propertyKey: string | symbol,
	messageType: IpcMessageType,
	type: IpcHandlerType,
): void {
	const ctor = target.constructor;
	let handlers = ipcHandlerRegistry.get(ctor);
	if (handlers == null) {
		handlers = new Map();
		ipcHandlerRegistry.set(ctor, handlers);
	}

	handlers.set(messageType.method, {
		method: messageType.method,
		propertyKey: propertyKey,
		type: type,
		requestType: type === 'request' ? (messageType as IpcRequest<unknown, unknown>) : undefined,
	});
}

/** Handler function type for commands - accepts params (or none if void), returns void */
type CommandHandler<Params> = Params extends void
	? () => void | Promise<void>
	: (params: Params) => void | Promise<void>;

/** Handler function type for requests - accepts params (or none if void), returns response */
type RequestHandler<Params, Response> = Params extends void
	? () => Response | Promise<Response>
	: (params: Params) => Response | Promise<Response>;

/**
 * Decorator that registers a handler (receives `params` and returns void) for an IPC command (fire-and-forget)
 */
export function ipcCommand<Params>(
	commandType: IpcCommand<Params>,
): <F extends CommandHandler<Params>>(
	target: object,
	propertyKey: string | symbol,
	descriptor: TypedPropertyDescriptor<F>,
) => void {
	return function <F extends CommandHandler<Params>>(
		target: object,
		propertyKey: string | symbol,
		_descriptor: TypedPropertyDescriptor<F>,
	): void {
		registerHandler(target, propertyKey, commandType, 'command');
	};
}

/**
 * Decorator that registers a handler (receives `params` and returns `Response`) for an IPC request (requires response)
 * Automatically calls `host.respond()` with the return value
 */
export function ipcRequest<Params, Response>(
	requestType: IpcRequest<Params, Response>,
): <F extends RequestHandler<Params, Response>>(
	target: object,
	propertyKey: string | symbol,
	descriptor: TypedPropertyDescriptor<F>,
) => void {
	return function <F extends RequestHandler<Params, Response>>(
		target: object,
		propertyKey: string | symbol,
		_descriptor: TypedPropertyDescriptor<F>,
	): void {
		registerHandler(target, propertyKey, requestType, 'request');
	};
}

/**
 * Dispatches an IPC message to the appropriate decorated method on the instance.
 *
 * For commands (`@ipcCommand`), the handler receives `params` and returns void.
 * For requests (`@ipcRequest`), the handler receives `params` and returns the response.
 * The dispatcher automatically calls `host.respond()` with the return value.
 *
 * @param host - The WebviewHost that will send the response for requests
 * @param instance - The object instance containing the handlers
 * @param e - The IPC message to dispatch
 * @returns true if a handler was found and invoked, false otherwise.
 */
export async function dispatchIpcMessage(host: WebviewHost<any>, instance: object, e: IpcMessage): Promise<boolean> {
	const handlers = ipcHandlerRegistry.get(instance.constructor);
	if (handlers == null) return false;

	const entry = handlers.get(e.method);
	if (entry == null) return false;

	// Get the method from the instance (ensures correct `this` binding)
	// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
	const handler = (instance as Record<string | symbol, Function>)[entry.propertyKey];
	if (typeof handler !== 'function') return false;

	switch (entry.type) {
		case 'command':
			// Commands receive just params
			await handler.call(instance, e.params);
			break;

		case 'request':
			// Requests receive params, and we auto-respond with the return value
			if (entry.requestType == null) {
				throw new Error(`@ipcRequest handler "${String(entry.propertyKey)}" missing requestType`);
			}
			// eslint-disable-next-line no-case-declarations
			const result = await handler.call(instance, e.params);
			void host.respond(entry.requestType, e, result);
			break;
	}

	return true;
}

/**
 * Creates a dispatcher function bound to a specific host and instance.
 * Useful when you need a reusable dispatcher or custom orchestration.
 */
export function createIpcDispatcher(host: WebviewHost<any>, instance: object): (e: IpcMessage) => Promise<boolean> {
	return e => dispatchIpcMessage(host, instance, e);
}
