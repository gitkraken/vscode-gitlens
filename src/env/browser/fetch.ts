const fetch = globalThis.fetch;
export { fetch };

export async function wrapForForcedInsecureSSL<T>(
	_ignoreSSLErrors: boolean | 'force',
	fetchFn: () => Promise<T> | Thenable<T>,
): Promise<T> {
	return fetchFn();
}
