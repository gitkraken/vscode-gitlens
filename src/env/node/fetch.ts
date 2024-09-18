import * as process from 'process';
import * as url from 'url';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fetch from 'node-fetch';
import { Logger } from '../../system/logger';
import { configuration } from '../../system/vscode/configuration';

export { fetch };
export type { BodyInit, HeadersInit, RequestInfo, RequestInit, Response } from 'node-fetch';

export function getProxyAgent(strictSSL?: boolean): HttpsProxyAgent | undefined {
	let proxyUrl: string | undefined;

	const proxy = configuration.get('proxy');
	if (proxy != null) {
		proxyUrl = proxy.url ?? undefined;
		strictSSL = strictSSL ?? proxy.strictSSL;
	} else {
		const proxySupport = configuration.getCore('http.proxySupport', undefined, 'override');

		if (proxySupport === 'off') {
			strictSSL = strictSSL ?? true;
		} else {
			strictSSL = strictSSL ?? configuration.getCore('http.proxyStrictSSL', undefined, true);
			proxyUrl = configuration.getCore('http.proxy') || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
		}
	}

	if (proxyUrl) {
		Logger.debug(`Using https proxy: ${proxyUrl}`);
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

export async function wrapForForcedInsecureSSL<T>(
	ignoreSSLErrors: boolean | 'force',
	fetchFn: () => Promise<T> | Thenable<T>,
): Promise<T> {
	if (ignoreSSLErrors !== 'force') return fetchFn();

	const previousRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

	try {
		return await fetchFn();
	} finally {
		process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousRejectUnauthorized;
	}
}
