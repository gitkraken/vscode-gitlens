import type { DisposableEndpoint } from '../webviewEndpoint.js';
import { createWebviewEndpoint } from '../webviewEndpoint.js';
import type { HostStorage } from './storage.js';
import { VsCodeStorage } from './storage.js';

export interface HostContext {
	readonly storage: HostStorage;
	createEndpoint(): DisposableEndpoint;
}

let _host: HostContext | undefined;

export function getHost(): HostContext {
	return (_host ??= createDefaultHost());
}

export function setHost(host: HostContext): void {
	_host = host;
}

function createDefaultHost(): HostContext {
	return {
		storage: new VsCodeStorage(),
		createEndpoint: () => createWebviewEndpoint(),
	};
}
