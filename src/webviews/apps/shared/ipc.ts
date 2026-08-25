/**
 * Minimal host-side API surface for webview apps.
 *
 * All host↔webview traffic rides RPC (see `webviewEndpoint.ts`); the remaining uses of the raw
 * VS Code webview API are `postMessage` (the RPC transport's outbound path) and
 * `getState`/`setState` (persistence, see `host/storage.ts`).
 */

export interface HostIpcApi {
	postMessage(msg: unknown): void;
	setState(state: unknown): void;
	getState(): unknown;
}

declare function acquireVsCodeApi(): HostIpcApi;

let _api: HostIpcApi | undefined;

export function getHostIpcApi(): HostIpcApi {
	return (_api ??= acquireVsCodeApi());
}

/** Stable per-JS-module-evaluation fingerprint identifying this iframe generation. Two sessions
 *  with the same `clientId` came from the same iframe (an element remount); two with different
 *  `clientId`s came from different iframes (VS Code recreated the iframe). */
const _clientId = `wv-${Math.random().toString(36).slice(2, 10)}`;
const _clientLoadedAt = Date.now();
export function getWebviewClientInfo(): { clientId: string; clientLoadedAt: number } {
	return { clientId: _clientId, clientLoadedAt: _clientLoadedAt };
}
