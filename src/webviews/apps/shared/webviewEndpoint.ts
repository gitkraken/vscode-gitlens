/**
 * Supertalk Endpoint adapter for VS Code webview side.
 *
 * Wraps the VS Code webview API to conform to Supertalk's Endpoint interface.
 * Uses a namespace wrapper so the shared pipe can carry non-RPC frames (e.g. persistence) safely.
 */
import type { Endpoint } from '@eamodio/supertalk';
import type { RpcMessageWrapper } from '../../rpc/constants.js';
import {
	decodeRpcPayload,
	encodeRpcPayload,
	inflateRpcPayload,
	isRpcMessage,
	RPC_NAMESPACE,
} from '../../rpc/constants.js';
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

/** Per-listener delivery pipeline — see {@link createOrderedDispatcher}. */
export interface OrderedDispatcher {
	dispatch(message: RpcMessageWrapper, event: MessageEvent): void;
	dispose(): void;
}

/**
 * Decodes an RPC wrapper's payload without decompressing — binary payloads are handled,
 * everything else passes through unchanged.
 */
function decodeSync(payload: unknown): unknown {
	return payload instanceof Uint8Array || payload instanceof ArrayBuffer ? decodeRpcPayload(payload) : payload;
}

/**
 * Builds a per-listener message dispatcher that preserves arrival order across a mix of
 * synchronous and asynchronous decoding.
 *
 * Supertalk's Endpoint listener is synchronous and order-dependent, but decompressing a
 * `compressed` payload requires an async `DecompressionStream` hop. Naively awaiting that hop
 * per-message would let a later uncompressed message race ahead of an earlier compressed one.
 * This chains every message onto a single promise so delivery order always matches arrival
 * order — except the overwhelmingly common case: an uncompressed message with nothing already
 * queued delivers synchronously, matching today's behavior exactly.
 */
export function createOrderedDispatcher(deliver: (data: unknown, event: MessageEvent) => void): OrderedDispatcher {
	let queued = 0;
	let chain = Promise.resolve();
	let disposed = false;

	return {
		dispatch: function (message: RpcMessageWrapper, event: MessageEvent): void {
			if (message.compressed == null && queued === 0) {
				deliver(decodeSync(message.payload), event);

				return;
			}

			queued++;
			chain = chain
				.then(async () => {
					try {
						if (disposed) return;

						let data: unknown;
						try {
							const { payload, compressed } = message;
							data =
								compressed === 'deflate-raw' &&
								(payload instanceof Uint8Array || payload instanceof ArrayBuffer)
									? await inflateRpcPayload(payload)
									: decodeSync(payload);
						} catch (ex) {
							debugger;
							// There is no degraded decode for a corrupt DEFLATE stream, so this message is lost — if it
							// carried a `return`/`resolve`/`reject`, its caller is stranded. Effectively unreachable for a
							// locally-framed payload, so log loudly rather than build a recovery path.
							console.error('RPC payload decompression failed; dropping message', ex);

							return;
						}

						deliver(data, event);
					} finally {
						queued--;
					}
				})
				.catch((ex: unknown) => {
					// A throwing listener must not break the chain — later messages still have to arrive
					console.error('RPC message delivery failed', ex);
				});
		},

		dispose: function (): void {
			disposed = true;
		},
	};
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
	const listeners = new Map<
		(event: MessageEvent) => void,
		{ wrapped: (event: MessageEvent) => void; dispatcher: OrderedDispatcher }
	>();

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

			// Ordered dispatcher: decompression is async, but Supertalk's listener is synchronous and
			// order-dependent — see createOrderedDispatcher.
			const dispatcher = createOrderedDispatcher((data, event) => {
				listener(
					new MessageEvent('message', {
						data: data,
						origin: event.origin,
						lastEventId: event.lastEventId,
						source: event.source,
						ports: [...event.ports],
					}),
				);
			});

			// Create a wrapper that filters for RPC messages and routes them through the dispatcher
			const wrappedListener = (event: MessageEvent) => {
				const message = event.data;
				// Only process messages with our RPC namespace
				if (!isRpcMessage(message)) return;

				dispatcher.dispatch(message, event);
			};

			listeners.set(listener, { wrapped: wrappedListener, dispatcher: dispatcher });
			window.addEventListener('message', wrappedListener);
		},

		removeEventListener: function (type: 'message', listener: (event: MessageEvent) => void): void {
			if (type !== 'message') return;

			const entry = listeners.get(listener);
			if (entry) {
				window.removeEventListener('message', entry.wrapped);
				entry.dispatcher.dispose();
				listeners.delete(listener);
			}
		},

		dispose: function (): void {
			// Remove all registered event listeners to prevent memory leaks
			for (const entry of listeners.values()) {
				window.removeEventListener('message', entry.wrapped);
				entry.dispatcher.dispose();
			}
			listeners.clear();
		},
	};
}
