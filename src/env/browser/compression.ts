/**
 * On the web-worker host, the webview runs in the same browser as the extension host — messages
 * never cross a network — so compression is pure CPU loss. Returning `undefined` tells the caller
 * to send the payload uncompressed, and keeps fflate out of the browser bundle.
 */
export function deflateRaw(_data: Uint8Array): Uint8Array | undefined {
	return undefined;
}
