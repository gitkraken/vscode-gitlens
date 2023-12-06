const fetch = globalThis.fetch;
export { fetch, fetch as insecureFetch };
import type { HttpsProxyAgent } from 'https-proxy-agent';

declare global {
	interface RequestInit {
		agent?: HttpsProxyAgent | undefined;
	}
}

declare type _BodyInit = BodyInit;
declare type _HeadersInit = HeadersInit;
declare type _RequestInit = RequestInit;
declare type _Response = Response;
declare type _RequestInfo = RequestInfo;
export type {
	_BodyInit as BodyInit,
	_HeadersInit as HeadersInit,
	_RequestInit as RequestInit,
	_Response as Response,
	_RequestInfo as RequestInfo,
};

export function getProxyAgent(_strictSSL?: boolean): HttpsProxyAgent | undefined {
	return undefined;
}

export async function wrapForForcedInsecureSSL<T>(
	_ignoreSSLErrors: boolean | 'force',
	fetchFn: () => Promise<T> | Thenable<T>,
): Promise<T> {
	return fetchFn();
}
