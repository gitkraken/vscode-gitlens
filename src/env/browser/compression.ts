import { deflateSync } from 'fflate';

/**
 * Raw DEFLATE at the fastest level — the format the webview side inflates with.
 *
 * The webworker host has no `zlib`, so this is the JS implementation. It is the slower of the two
 * (see the node counterpart) but produces the same raw DEFLATE, so a payload compressed here is read
 * by any webview and vice versa.
 */
export function deflateRaw(data: Uint8Array): Uint8Array {
	return deflateSync(data, { level: 1 });
}
