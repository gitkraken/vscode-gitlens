import * as url from 'url';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fetch, { RequestInfo, RequestInit, Response } from 'node-fetch';
import { configuration } from '../../configuration';

export { fetch };
export type { BodyInit, RequestInit, Response } from 'node-fetch';

export type FetchLike = (url: RequestInfo, init?: RequestInit | undefined) => Promise<Response>;

export function getProxyAgent(strictSSL?: boolean): HttpsProxyAgent | undefined {
	let proxyUrl: string | undefined;

	const proxy = configuration.get('proxy');
	if (proxy != null) {
		proxyUrl = proxy.url ?? undefined;
		strictSSL = strictSSL ?? proxy.strictSSL;
	} else {
		const proxySupport = configuration.getAny<'off' | 'on' | 'override' | 'fallback'>(
			'http.proxySupport',
			undefined,
			'override',
		);

		if (proxySupport === 'off') {
			strictSSL = strictSSL ?? true;
		} else {
			strictSSL = strictSSL ?? configuration.getAny<boolean>('http.proxyStrictSSL', undefined, true);
			proxyUrl = configuration.getAny<string>('http.proxy') || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
		}
	}

	if (proxyUrl) {
		return new HttpsProxyAgent({
			...url.parse(proxyUrl),
			rejectUnauthorized: strictSSL,
		});
	}

	if (strictSSL === false) {
		return new HttpsProxyAgent({
			rejectUnauthorized: false,
		});
	}

	return undefined;
}

export async function insecureFetch(url: RequestInfo, init?: RequestInit): Promise<Response> {
	const previousRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

	try {
		return await fetch(url, init);
	} finally {
		process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousRejectUnauthorized;
	}
}
