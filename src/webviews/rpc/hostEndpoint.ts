/**
 * Supertalk Endpoint adapter for VS Code extension host side.
 *
 * Wraps the VS Code Webview API to conform to Supertalk's Endpoint interface.
 * Uses a namespace wrapper to avoid collisions with existing IPC messages.
 */
import type { Endpoint } from '@eamodio/supertalk';
import type { Disposable, Webview } from 'vscode';
import type { RpcMessageWrapper } from './constants.js';
import { decodeRpcPayload, encodeRpcPayload, isRpcMessage, RPC_NAMESPACE } from './constants.js';

// Re-export for convenience
export type { RpcMessageWrapper } from './constants.js';
export { isRpcMessage, RPC_NAMESPACE } from './constants.js';

/**
 * Creates a Supertalk-compatible Endpoint from a VS Code Webview.
 *
 * Messages are wrapped with a namespace to avoid collisions with existing
 * IPC messages. Only messages with the RPC namespace are processed.
 *
 * @param webview - The VS Code Webview instance
 * @returns An Endpoint that can be used with Supertalk's expose() function
 */
export function createHostEndpoint(webview: Webview): Endpoint & Disposable {
	const listeners = new Map<(event: MessageEvent) => void, Disposable>();

	return {
		postMessage: function (message: unknown, _transfer?: unknown[]): void {
			// Note: _transfer is ignored because VS Code webviews do not support Transferables.
			// All data is serialized via JSON, so using supertalk's transfer() will clone rather
			// than transfer ownership.

			// Encode the Supertalk message as a Uint8Array. VS Code extracts TypedArrays
			// before JSON.stringify, sends them as raw binary, and zero-copy transfers
			// through Structured Clone hops — avoiding 2 deep copies on the renderer thread.
			const wrapped: RpcMessageWrapper = {
				[RPC_NAMESPACE]: true,
				payload: encodeRpcPayload(message),
			};
			// VS Code webview.postMessage returns a Thenable, but Endpoint expects void
			// We fire and forget here; errors are handled by VS Code
			void webview.postMessage(wrapped);
		},

		addEventListener: function (type: 'message', listener: (event: MessageEvent) => void): void {
			if (type !== 'message') return;

			// VS Code onDidReceiveMessage provides the message directly, not wrapped in MessageEvent
			// We need to wrap it to match the Endpoint interface
			const disposable = webview.onDidReceiveMessage((message: unknown) => {
				// Only process messages with our RPC namespace
				if (!isRpcMessage(message)) return;

				// Decode binary payload if present, fall back to plain object
				const { payload } = message;
				const data =
					payload instanceof Uint8Array || payload instanceof ArrayBuffer
						? decodeRpcPayload(payload)
						: payload;

				// Create a MessageEvent-like object with the unwrapped payload
				const event = {
					data: data,
					// These are required by MessageEvent but not used by Supertalk
					origin: '',
					lastEventId: '',
					source: null,
					ports: [],
				} as unknown as MessageEvent;
				listener(event);
			});

			listeners.set(listener, disposable);
		},

		removeEventListener: function (type: 'message', listener: (event: MessageEvent) => void): void {
			if (type !== 'message') return;

			const disposable = listeners.get(listener);
			if (disposable) {
				disposable.dispose();
				listeners.delete(listener);
			}
		},

		dispose: function (): void {
			for (const disposable of listeners.values()) {
				disposable.dispose();
			}
			listeners.clear();
		},
	};
}
