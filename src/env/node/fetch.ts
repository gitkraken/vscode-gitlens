import * as url from 'url';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fetch from 'node-fetch';
import { configuration } from '../../configuration';

export { fetch };
export type { BodyInit, RequestInit, Response } from 'node-fetch';

export function getProxyAgent(): HttpsProxyAgent | undefined {
	let strictSSL: boolean | undefined;
	let proxyUrl: string | undefined;

	const proxy = configuration.get('proxy');
	if (proxy != null) {
		proxyUrl = proxy.url ?? undefined;
		strictSSL = proxy.strictSSL;
	} else {
		const proxySupport = configuration.getAny<'off' | 'on' | 'override' | 'fallback'>(
			'http.proxySupport',
			undefined,
			'override',
		);
		if (proxySupport === 'off') return undefined;

		strictSSL = configuration.getAny<boolean>('http.proxyStrictSSL', undefined, true);
		proxyUrl = configuration.getAny<string>('http.proxy') || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
	}

	if (proxyUrl) {
		return new HttpsProxyAgent({
			...url.parse(proxyUrl),
			rejectUnauthorized: strictSSL,
		});
	}

	if (!strictSSL) {
		return new HttpsProxyAgent({
			rejectUnauthorized: false,
		});
	}

	return undefined;
}
