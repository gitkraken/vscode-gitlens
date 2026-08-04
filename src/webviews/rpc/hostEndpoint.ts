/**
 * Supertalk Endpoint adapter for VS Code extension host side.
 *
 * Wraps the VS Code Webview API to conform to Supertalk's Endpoint interface.
 * Uses a namespace wrapper to avoid collisions with existing IPC messages.
 *
 * Includes a visibility-aware message buffer for `retainContextWhenHidden` webviews.
 * When hidden, VS Code silently drops `webview.postMessage()` calls. The buffer
 * intercepts messages BEFORE encoding and replays them on visibility restore.
 *
 * Dedup strategy (applies to individual messages inside Supertalk batches):
 * - `type: 'handler'` (signals, events): Last-write-wins per `wireType` — only the
 *   most recent value survives. This matches EventVisibilityBuffer's semantics.
 * - All other types (`call`, `return`, `release`, `resolve`, `reject`, `throw`):
 *   FIFO queue — each is a unique logical operation.
 *
 * On visibility restore, the FIFO queue flushes first (preserving order), then
 * the deduped handler map values. This ensures RPC responses arrive before the
 * signal/event catch-up burst.
 */
import type { Endpoint } from '@eamodio/supertalk';
import type { Disposable, Webview } from 'vscode';
import { Logger } from '@gitlens/utils/logger.js';
import type { RpcMessageWrapper } from './constants.js';
import { decodeRpcPayload, encodeRpcPayload, isRpcMessage, RPC_NAMESPACE } from './constants.js';

// Re-export for convenience
export type { RpcMessageWrapper } from './constants.js';
export { isRpcMessage, RPC_NAMESPACE } from './constants.js';

/** Supertalk message with a type discriminator. */
interface TypedMessage {
	type: string;
	wireType?: string;
	[key: string]: unknown;
}

/** Extended Endpoint with visibility control. */
export interface BufferedEndpoint extends Endpoint, Disposable {
	/** Update visibility state. When transitioning to visible, flushes buffered messages. */
	setVisible(visible: boolean): void;
}

/** Depth at which the hidden-side FIFO is reported as suspicious (see {@link bufferMessage}). */
const fifoWarnThreshold = 500;

/**
 * Creates a Supertalk-compatible Endpoint from a VS Code Webview.
 *
 * Messages are wrapped with a namespace to avoid collisions with existing
 * IPC messages. Only messages with the RPC namespace are processed.
 *
 * @param webview - The VS Code Webview instance
 * @returns A BufferedEndpoint that can be used with Supertalk's expose() function
 */
export function createHostEndpoint(webview: Webview): BufferedEndpoint {
	const listeners = new Map<(event: MessageEvent) => void, Disposable>();

	let visible = true;
	// FIFO queue for non-dedup-able messages (calls, returns, etc.)
	const fifoQueue: TypedMessage[] = [];
	// Last-write-wins map for handler messages (signals, events), keyed by wireType
	const handlerMap = new Map<string, TypedMessage>();

	function doPost(message: unknown): void {
		const wrapped: RpcMessageWrapper = {
			[RPC_NAMESPACE]: true,
			payload: encodeRpcPayload(message),
		};
		void webview.postMessage(wrapped);
	}

	/**
	 * Buffer a single Supertalk message (not a batch wrapper).
	 * Handler messages are deduped by wireType; everything else is queued FIFO.
	 */
	function bufferMessage(msg: TypedMessage): void {
		if (msg.type === 'handler' && msg.wireType != null) {
			handlerMap.set(msg.wireType, msg);
		} else {
			// Deliberately uncapped: unlike the deduped handler map, every entry here is a distinct logical
			// operation, and dropping a `return`/`resolve`/`reject` strands the webview promise waiting on it
			// forever. Bounding this safely means tearing the connection down and forcing a refresh, not
			// discarding messages — warn instead so a runaway shows up rather than hanging silently.
			fifoQueue.push(msg);
			if (fifoQueue.length === fifoWarnThreshold) {
				Logger.warn(
					`RPC host endpoint has buffered ${fifoWarnThreshold} messages while hidden; the webview may be producing calls faster than visibility is restored`,
				);
			}
		}
	}

	/**
	 * Flush all buffered messages — FIFO queue first (preserving order), then the deduped handler values.
	 * Re-batched into a single post: messages are unbatched on the way in only so handler dedup can see
	 * them individually, and Supertalk's Connection unpacks `type: 'batch'` on receive, so replaying them
	 * one-by-one just pays a structured-clone hop per message for no benefit.
	 */
	function flush(): void {
		if (fifoQueue.length === 0 && handlerMap.size === 0) return;

		const messages = fifoQueue.splice(0);
		messages.push(...handlerMap.values());
		handlerMap.clear();

		if (messages.length === 1) {
			doPost(messages[0]);
			return;
		}

		doPost({ type: 'batch', messages: messages });
	}

	return {
		postMessage: function (message: unknown, _transfer?: unknown[]): void {
			// Note: _transfer is ignored because VS Code webviews do not support Transferables.
			// All data is serialized via JSON, so using supertalk's transfer() will clone rather
			// than transfer ownership.

			if (visible) {
				// Encode the Supertalk message as a Uint8Array. VS Code extracts TypedArrays
				// before JSON.stringify, sends them as raw binary, and zero-copy transfers
				// through Structured Clone hops — avoiding 2 deep copies on the renderer thread.
				doPost(message);
				return;
			}

			// Hidden: buffer messages for replay on visibility restore
			const msg = message as TypedMessage;
			if (msg.type === 'batch' && Array.isArray(msg.messages)) {
				// Unbatch and buffer individually for per-message dedup
				for (const inner of msg.messages as TypedMessage[]) {
					bufferMessage(inner);
				}
			} else {
				bufferMessage(msg);
			}
		},

		setVisible: function (v: boolean): void {
			visible = v;
			if (v) {
				flush();
			}
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
			fifoQueue.length = 0;
			handlerMap.clear();
			for (const disposable of listeners.values()) {
				disposable.dispose();
			}
			listeners.clear();
		},
	};
}
