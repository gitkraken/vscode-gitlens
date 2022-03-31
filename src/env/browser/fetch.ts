const fetch = globalThis.fetch;
export { fetch };

declare global {
	interface RequestInit {
		agent?: undefined;
	}
}

declare type _BodyInit = BodyInit;
declare type _RequestInit = RequestInit;
declare type _Response = Response;
export type { _BodyInit as BodyInit, _RequestInit as RequestInit, _Response as Response };

export function getProxyAgent(): undefined {
	return undefined;
}
