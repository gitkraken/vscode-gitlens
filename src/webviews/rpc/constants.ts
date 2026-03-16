/**
 * Shared constants for Supertalk RPC integration.
 *
 * This file contains constants that need to be shared between the extension
 * host and webview bundles.
 */

/** Namespace for Supertalk RPC messages to distinguish from existing IPC */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const RPC_NAMESPACE = '__supertalk_rpc__';

/** Wrapper for Supertalk messages sent over VS Code webview channel */
export interface RpcMessageWrapper {
	[RPC_NAMESPACE]: true;
	payload: unknown;
}

/** Type guard to check if a message is a Supertalk RPC message */
export function isRpcMessage(message: unknown): message is RpcMessageWrapper {
	return (
		typeof message === 'object' &&
		message !== null &&
		RPC_NAMESPACE in message &&
		(message as RpcMessageWrapper)[RPC_NAMESPACE] === true
	);
}

// Cached encoder/decoder instances for binary payload encoding
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Encodes a Supertalk message as a Uint8Array for binary transit through VS Code IPC.
 *
 * VS Code extracts TypedArrays from postMessage payloads before JSON serialization,
 * sends them as raw binary through the IPC channel, and zero-copy transfers them
 * through the Structured Clone hops in the renderer. This avoids 2 expensive
 * structuredClone deep copies on the renderer UI thread.
 */
export function encodeRpcPayload(message: unknown): Uint8Array {
	return textEncoder.encode(JSON.stringify(message));
}

/**
 * Decodes a binary payload back to a Supertalk message.
 * Accepts Uint8Array or ArrayBuffer for robustness against
 * VS Code's internal buffer type normalization.
 */
export function decodeRpcPayload(data: Uint8Array | ArrayBuffer): unknown {
	return JSON.parse(textDecoder.decode(data));
}
