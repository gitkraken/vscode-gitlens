import ProviderApis from '@gitkraken/provider-apis';
import { getAuthenticatedUser } from '../errors.js';
import type { ProviderRequestFunction, ProviderRequestOptions, ProviderRequestResponse } from './models.js';
import {
	AnonymousResponseError,
	getProviderResponseBodyMessage,
	markRequestError,
	UnexpectedHtmlResponseError,
} from './providerErrors.js';

// `@gitkraken/provider-apis` is published as CommonJS with its factory on the `default` export.
// How that surfaces depends on the consuming bundler's CJS->ESM interop: esbuild yields the
// callable factory directly, while webpack and Node surface the module namespace (with the
// factory under `.default`). Normalize to the callable factory so every consumer resolves it.
type ProviderApisFactory = typeof ProviderApis;
export const createProviderApis: ProviderApisFactory =
	(ProviderApis as ProviderApisFactory & { default?: ProviderApisFactory }).default ?? ProviderApis;

export function createProviderApiRequest(
	fetch: (input: string | URL, init?: RequestInit) => Promise<Response>,
	userAgent?: string,
): ProviderRequestFunction {
	return async <T>({ url, ...options }: ProviderRequestOptions): Promise<ProviderRequestResponse<T>> => {
		try {
			const response = await fetch(url, {
				...options,
				headers: { ...(userAgent != null ? { 'User-Agent': userAgent } : {}), ...options.headers },
			});
			return await parseFetchResponseForApi<T>(response, () => hasAuthorization(options.headers));
		} catch (ex) {
			throw markRequestError(ex);
		}
	};
}

export async function parseFetchResponseForApi<T>(
	response: Response,
	sentCredential?: () => boolean,
): Promise<ProviderRequestResponse<T>> {
	// Media types are case-insensitive (RFC 9110 §8.3.1) and `fetch` hands the header back exactly as the server
	// wrote it, so match on a lowercased copy rather than the raw value.
	const contentType = (response.headers.get('content-type') || '').toLowerCase();

	// A credential the server served as the anonymous user was rejected, whatever the body says; reading it as data
	// reports an account with nothing in it (see `AnonymousResponseError`). Checked before the body is parsed, which
	// may itself fail. A 401 already fails as the credential's rejection, with its body, and a throttle or a server
	// failure keeps its own error: neither proves anything about the credential.
	if (
		response.status !== 401 &&
		response.status !== 429 &&
		response.status < 500 &&
		getAuthenticatedUser(response.headers) === 'anonymous' &&
		sentCredential?.() === true
	) {
		// Released rather than left for the collector: an unread body holds its connection.
		void response.body?.cancel().catch(() => undefined);
		throw new AnonymousResponseError(response.status, {
			headers: Object.fromEntries(response.headers.entries()),
			status: response.status,
		});
	}

	let body;
	let servedHtml = false;

	// parse the response body
	if (contentType.startsWith('application/json')) {
		const text = await response.text();
		// A sign-in page a server mislabels as JSON is the same page under another header, and `<` can never open
		// valid JSON — so recognize it rather than letting JSON.parse throw a SyntaxError carrying no status.
		if (text.trimStart().startsWith('<')) {
			servedHtml = true;
			body = text;
		} else {
			body = text.trim().length > 0 ? JSON.parse(text) : null;
		}
	} else if (contentType.startsWith('text/') || contentType === '') {
		body = await response.text();
		// An empty body is never a sign-in page, and a write answering `204` can carry a stale `text/html` from
		// whatever its endpoint usually returns — so require actual markup, not just the header.
		servedHtml = contentType.startsWith('text/html') && body.trim().length > 0;
	} else if (contentType.startsWith('application/vnd.github.raw+json')) {
		body = await response.arrayBuffer();
	} else {
		throw new Error(`Unsupported content-type: ${contentType}`);
	}

	const result = {
		body: body,
		headers: Object.fromEntries(response.headers.entries()),
		status: response.status,
		statusText: response.statusText,
	};

	// A 2xx carrying a page rather than data is a rejected credential wearing a success status (GKDEV-3617); a
	// non-2xx keeps its own status error below, which is the better diagnostic.
	if (response.ok && servedHtml) {
		throw new UnexpectedHtmlResponseError(response.status, contentType, result);
	}

	// throw an error if the response is not ok
	if (!response.ok) {
		const status = `(${response.status})${response.statusText ? ` ${response.statusText}` : ''}.`;
		const detail = getProviderResponseBodyMessage(body);
		const error = new Error(detail != null ? `${status} ${detail}` : status);
		Object.assign(error, { response: result });
		throw error;
	}

	return result;
}

function hasAuthorization(headers: ProviderRequestOptions['headers']): boolean {
	if (headers == null) return false;

	return Object.entries(headers).some(([name, value]) => name.toLowerCase() === 'authorization' && Boolean(value));
}
