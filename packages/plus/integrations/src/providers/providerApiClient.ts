import { captureProviderRead } from '@gitkraken/provider-apis/read-provenance';
import { getAuthenticatedUser } from '../errors.js';
import type { ProviderRequestFunction, ProviderRequestOptions, ProviderRequestResponse } from './models.js';
import {
	AnonymousResponseError,
	getProviderResponseBodyMessage,
	markRequestError,
	UnexpectedHtmlResponseError,
} from './providerErrors.js';

export function createProviderApiRequest(
	fetch: (input: string | URL, init?: RequestInit) => Promise<Response>,
	userAgent?: string,
): ProviderRequestFunction {
	return async <T>({ url, ...options }: ProviderRequestOptions): Promise<ProviderRequestResponse<T>> => {
		try {
			return await captureProviderRead(async () => {
				const response = await fetch(url, {
					...options,
					headers: { ...(userAgent != null ? { 'User-Agent': userAgent } : {}), ...options.headers },
				});
				return parseFetchResponseForApi<T>(response, () => hasAuthorization(options.headers), url);
			});
		} catch (ex) {
			throw markRequestError(ex, { url: url, method: options.method });
		}
	};
}

export async function parseFetchResponseForApi<T>(
	response: Response,
	sentCredential?: () => boolean,
	requestUrl = response.url,
): Promise<ProviderRequestResponse<T>> {
	const contentType = (response.headers.get('content-type') || '').toLowerCase();

	if (
		response.status !== 401 &&
		response.status !== 429 &&
		response.status < 500 &&
		getAuthenticatedUser(response.headers) === 'anonymous' &&
		sentCredential?.() === true
	) {
		void response.body?.cancel().catch(() => undefined);
		throw new AnonymousResponseError(response.status, {
			headers: Object.fromEntries(response.headers.entries()),
			status: response.status,
		});
	}

	let body;
	let servedHtml = false;

	const headers = Object.fromEntries(response.headers.entries());
	try {
		if (!response.ok && requestUrl === 'https://api.github.com/graphql') {
			// KEEP: GraphQL execution evidence can arrive with a missing or incorrect media type.
			body = await response.json();
			if (body == null || typeof body !== 'object' || Array.isArray(body)) {
				throw new Error('Expected a GitHub GraphQL response object.');
			}
		} else if (contentType.startsWith('application/json')) {
			const text = await response.text();
			if (text.trimStart().startsWith('<')) {
				servedHtml = true;
				body = text;
			} else {
				body = text.trim().length > 0 ? JSON.parse(text) : null;
			}
		} else if (contentType.startsWith('text/') || contentType === '') {
			body = await response.text();
			servedHtml = contentType.startsWith('text/html') && body.trim().length > 0;
		} else if (contentType.startsWith('application/vnd.github.raw+json')) {
			body = await response.arrayBuffer();
		} else {
			void response.body?.cancel().catch(() => undefined);
			throw new Error(`Unsupported content-type: ${contentType}`);
		}
	} catch (ex) {
		if (response.ok) throw ex;

		const retryAfter = response.status === 403 ? response.headers.get('retry-after') : null;
		throw Object.assign(new Error(`(${response.status}) Unable to decode the provider response.`), {
			statusCode: response.status,
			...(retryAfter != null && {
				response: { status: response.status, headers: { 'retry-after': retryAfter } },
			}),
		});
	}

	const result = {
		body: body,
		headers: headers,
		status: response.status,
		statusText: response.statusText,
	};

	if (response.ok && servedHtml) {
		throw new UnexpectedHtmlResponseError(response.status, contentType, result);
	}

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
