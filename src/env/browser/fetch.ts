const fetch = globalThis.fetch;
export { fetch, fetch as insecureFetch };
import type { HttpsProxyAgent } from 'https-proxy-agent';

declare global {
	interface RequestInit {
		agent?: HttpsProxyAgent | undefined;
	}
}

declare type _BodyInit = BodyInit;
declare type _RequestInit = RequestInit;
declare type _Response = Response;
export type { _BodyInit as BodyInit, _RequestInit as RequestInit, _Response as Response };

export function getProxyAgent(_strictSSL?: boolean): HttpsProxyAgent | undefined {
	return undefined;
}

declare type FetchLike = (url: RequestInfo, init?: RequestInit | undefined) => Promise<Response>;
export type { FetchLike };
