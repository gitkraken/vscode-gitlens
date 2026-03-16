/**
 * Supertalk Endpoint adapter for VS Code webview side.
 *
 * Wraps the VS Code webview API to conform to Supertalk's Endpoint interface.
 * Uses a namespace wrapper to avoid collisions with existing IPC messages.
 */
import type { Endpoint } from '@eamodio/supertalk';
import type { RpcMessageWrapper } from '../../rpc/constants.js';
import { decodeRpcPayload, encodeRpcPayload, isRpcMessage, RPC_NAMESPACE } from '../../rpc/constants.js';
import { getHostIpcApi } from './ipc.js';

// Re-export for convenience
export type { RpcMessageWrapper } from '../../rpc/constants.js';
export { isRpcMessage, RPC_NAMESPACE } from '../../rpc/constants.js';

/**
 * Extended Endpoint interface with disposal support.
 */
export interface DisposableEndpoint extends Endpoint {
	/**
	 * Disposes the endpoint, removing all registered event listeners.
	 * Call this when the component unmounts to prevent memory leaks.
	 */
	dispose(): void;
}

/**
 * Creates a Supertalk-compatible Endpoint for the webview side.
 *
 * Uses the VS Code webview API for postMessage and window for message events.
 * Messages are wrapped with a namespace to avoid collisions with existing IPC.
 *
 * IMPORTANT: Call `dispose()` when the component unmounts to clean up event listeners.
 *
 * @returns A DisposableEndpoint that can be used with Supertalk's wrap() function
 */
export function createWebviewEndpoint(): DisposableEndpoint {
	const api = getHostIpcApi();
	const listeners = new Map<(event: MessageEvent) => void, (event: MessageEvent) => void>();

	return {
		postMessage: function (message: unknown, _transfer?: Transferable[]): void {
			// Encode the Supertalk message as a Uint8Array. VS Code extracts TypedArrays
			// before JSON.stringify, sends them as raw binary, and zero-copy transfers
			// through Structured Clone hops — avoiding 2 deep copies on the renderer thread.
			const wrapped: RpcMessageWrapper = {
				[RPC_NAMESPACE]: true,
				payload: encodeRpcPayload(message),
			};
			api.postMessage(wrapped);
		},

		addEventListener: function (type: 'message', listener: (event: MessageEvent) => void): void {
			if (type !== 'message') return;

			// Create a wrapper that filters for RPC messages and unwraps them
			const wrappedListener = (event: MessageEvent) => {
				const message = event.data;
				// Only process messages with our RPC namespace
				if (!isRpcMessage(message)) return;

				// Decode binary payload if present, fall back to plain object
				const { payload } = message;
				const data =
					payload instanceof Uint8Array || payload instanceof ArrayBuffer
						? decodeRpcPayload(payload)
						: payload;

				// Create a new event with the unwrapped payload
				const unwrappedEvent = new MessageEvent('message', {
					data: data,
					origin: event.origin,
					lastEventId: event.lastEventId,
					source: event.source,
					ports: [...event.ports],
				});
				listener(unwrappedEvent);
			};

			listeners.set(listener, wrappedListener);
			window.addEventListener('message', wrappedListener);
		},

		removeEventListener: function (type: 'message', listener: (event: MessageEvent) => void): void {
			if (type !== 'message') return;

			const wrappedListener = listeners.get(listener);
			if (wrappedListener) {
				window.removeEventListener('message', wrappedListener);
				listeners.delete(listener);
			}
		},

		dispose: function (): void {
			// Remove all registered event listeners to prevent memory leaks
			for (const wrappedListener of listeners.values()) {
				window.removeEventListener('message', wrappedListener);
			}
			listeners.clear();
		},
	};
}
