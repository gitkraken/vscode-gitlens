let _forceInsecureSSL = 0;

export function fetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
	return globalThis.fetch(url, init);
}

export async function wrapForForcedInsecureSSL<T>(
	ignoreSSLErrors: boolean | 'force',
	fetchFn: () => Promise<T> | Thenable<T>,
): Promise<T> {
	if (ignoreSSLErrors !== 'force' && ignoreSSLErrors !== true) return fetchFn();

	_forceInsecureSSL++;
	if (_forceInsecureSSL === 1) {
		globalThis.process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
	}
	try {
		return await fetchFn();
	} finally {
		_forceInsecureSSL--;
		if (_forceInsecureSSL === 0) {
			globalThis.process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';
		}
	}
}
