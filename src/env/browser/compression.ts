/**
 * The browser host has no cheap native deflate — only fflate's JS implementation, which isn't worth
 * its bundle size or CPU here: in the common web case the webview runs in the same browser as the
 * extension host, so messages never cross a network (and when they do — e.g. vscode.dev over a
 * tunnel — the caller treats `undefined` as "send uncompressed" and skips compression entirely).
 */
export function deflateRaw(_data: Uint8Array): Uint8Array | undefined {
	return undefined;
}
