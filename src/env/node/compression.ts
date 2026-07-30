import { deflateRawSync } from 'node:zlib';

/**
 * Raw DEFLATE at the fastest level — the format the webview side inflates with.
 *
 * Node's zlib is native and costs nothing to bundle, where the JS implementation the browser host
 * falls back to is ~9x slower at this level (measured: 46ms vs 5ms on a ~7MB payload) and compresses
 * marginally worse. Both produce raw DEFLATE, so either side can read the other's output — a host and
 * a webview from different builds still understand each other.
 */
export function deflateRaw(data: Uint8Array): Uint8Array {
	const deflated = deflateRawSync(data, { level: 1 });
	// A view, not a copy: `Buffer` is a `Uint8Array` subclass backed by a pooled allocation, so hand
	// the message channel a plain view over exactly these bytes.
	return new Uint8Array(deflated.buffer, deflated.byteOffset, deflated.byteLength);
}
