import type { TokenWithInfo } from '../authentication/models.js';
import type { IntegrationIds } from '../constants.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../constants.js';
import {
	AuthenticationError,
	AuthenticationErrorReason,
	isRateLimitResponse,
	RequestClientError,
	RequestNotFoundError,
	toError,
	toRateLimitError,
} from '../errors.js';

const maxProviderErrorBodyLength = 500;

/**
 * A 2xx response carrying an HTML page instead of data.
 *
 * Azure DevOps answers a rejected credential by redirecting to its sign-in page, which then returns
 * `203 text/html` rather than `401`. `response.ok` spans the whole 200-299 range, so that page used to be read as
 * a successful body and handed to provider code typed as the JSON it is not — surfacing as an opaque `TypeError`
 * deep inside a provider, or as nothing at all on a route that returns `void`, which made a bad credential look
 * like a successful write (GKDEV-3617).
 *
 * `provider-apis` 0.59.0 raises its own error for this, but only from the transport it wraps; this package passes
 * its own already-parsed request function, so the check has to live here too.
 *
 * The message carries no URL, and the attached response is stripped of its credential-bearing headers and cut to
 * a diagnostic prefix: an error is something a consumer may reasonably log or forward, and the response it is
 * built from is a sign-in page carrying a session cookie.
 */
export class UnexpectedHtmlResponseError extends Error {
	static is(ex: unknown): ex is UnexpectedHtmlResponseError {
		return ex instanceof UnexpectedHtmlResponseError;
	}

	readonly response: SanitizedErrorResponse;

	constructor(status: number, contentType: string, response: ProviderErrorResponse | undefined) {
		super(`(${status}) Expected data but the provider returned an HTML page (content-type: ${contentType})`);

		this.response = sanitizeErrorResponse(status, response);

		Error.captureStackTrace?.(this, new.target);
	}
}

type ProviderErrorResponse = { body?: unknown; headers?: Record<string, string>; status?: number };
type SanitizedErrorResponse = { body?: string; headers: Record<string, string>; status: number };

/**
 * Response headers a rejected-credential page carries that must not ride along on an error: the session cookie it
 * sets, the challenges whose base64 payload decodes to the tenant or the internal domain, and the request-side
 * names a substituted fetch can echo back onto a response.
 */
const unloggableResponseHeaders = new Set([
	'authentication-info',
	'authorization',
	'cookie',
	'proxy-authenticate',
	'proxy-authentication-info',
	'proxy-authorization',
	'set-cookie',
	'www-authenticate',
	'x-api-key',
	'x-auth-token',
]);

/** Strips the credential-bearing headers from a response and cuts its body to a diagnostic prefix. */
function sanitizeErrorResponse(status: number, response: ProviderErrorResponse | undefined): SanitizedErrorResponse {
	const headers: Record<string, string> = {};
	for (const [name, value] of Object.entries(response?.headers ?? {})) {
		if (unloggableResponseHeaders.has(name.toLowerCase())) continue;

		headers[name] = value;
	}

	const body = response?.body;
	return {
		// A sign-in page runs to tens of kilobytes and none of it is a diagnostic; keep only what identifies it.
		...(typeof body === 'string' ? { body: body.slice(0, maxProviderErrorBodyLength) } : {}),
		headers: headers,
		status: response?.status ?? status,
	};
}

const linearIssueNotFoundMessage = /^Linear issue not found: .+$/i;

type ProviderGraphQLError = {
	message?: unknown;
	extensions?: { code?: unknown };
};

function getProviderGraphQLErrors(body: unknown): ProviderGraphQLError[] {
	if (body == null || typeof body !== 'object') return [];

	const errors = (body as { errors?: unknown }).errors;
	return Array.isArray(errors)
		? errors.filter((error): error is ProviderGraphQLError => error != null && typeof error === 'object')
		: [];
}

export function isAzureProviderId(
	providerId: IntegrationIds,
): providerId is GitCloudHostIntegrationId.AzureDevOps | GitSelfManagedHostIntegrationId.AzureDevOpsServer {
	return (
		providerId === GitCloudHostIntegrationId.AzureDevOps ||
		providerId === GitSelfManagedHostIntegrationId.AzureDevOpsServer
	);
}

export function isGitHubProviderId(
	providerId: IntegrationIds,
): providerId is GitCloudHostIntegrationId.GitHub | GitSelfManagedHostIntegrationId.CloudGitHubEnterprise {
	return (
		providerId === GitCloudHostIntegrationId.GitHub ||
		providerId === GitSelfManagedHostIntegrationId.CloudGitHubEnterprise
	);
}

/**
 * GitHub's GraphQL schema declares coordinate variables (issue/PR number) as `Int!`, a 32-bit signed integer.
 * A number above this coerces with no `path` on the error, which fails every aliased target in the chunk rather
 * than just the one with the bad number — so the read layer refuses the whole call up front instead.
 */
export const githubGraphQLInt32Max = 2147483647;

function isLinearRateLimitError(providerId: IntegrationIds, ex: unknown): boolean {
	if (providerId !== IssuesCloudHostIntegrationId.Linear) return false;

	const body = (ex as { response?: { body?: unknown } }).response?.body;
	return getProviderGraphQLErrors(body).some(error => error.extensions?.code === 'RATELIMITED');
}

export function isProviderIssueNotFoundError(providerId: IntegrationIds, ex: unknown): boolean {
	if (providerId === IssuesCloudHostIntegrationId.Linear) {
		return ex instanceof Error && linearIssueNotFoundMessage.test(ex.message);
	}

	const status = (ex as { response?: { status?: unknown } }).response?.status;
	return status === 404 || status === 410 || status === 422;
}

export function throwProviderError(tokenWithInfo: TokenWithInfo, error: unknown): never {
	const { accessToken: token, ...tokenInfo } = tokenWithInfo;
	const providerId = tokenWithInfo.providerId;
	const normalizedError = toError(error);
	// A page served with a 2xx is only known to mean a rejected credential on Azure DevOps, which answers one by
	// redirecting to its sign-in page (GKDEV-3617). Elsewhere it is far more likely a maintenance or WAF page in
	// front of a provider, and calling that an authentication failure is not free: `handleProviderException`
	// expires a valid cloud session on one, and counts it against the budget that disconnects the integration.
	// So Azure gets the specific diagnosis and every other provider gets the honest one — the response was not
	// data, which is a protocol failure.
	if (UnexpectedHtmlResponseError.is(error)) {
		throw isAzureProviderId(providerId)
			? new AuthenticationError(tokenInfo, AuthenticationErrorReason.Unauthorized, normalizedError)
			: new RequestClientError(normalizedError);
	}

	// Linear reports GraphQL throttling as HTTP 400, so its structured code must win over generic 4xx handling.
	if (isLinearRateLimitError(providerId, error)) {
		throw toRateLimitError(normalizedError, token);
	}

	const status = (error as { response?: { status?: unknown } }).response?.status;
	if (typeof status === 'number') {
		switch (status) {
			case 404:
			case 410:
			case 422:
				throw new RequestNotFoundError(normalizedError);
			case 429:
				throw toRateLimitError(normalizedError, token);
			case 401:
			case 403:
				// Some hosts overload 403 for throttling; classify that before asking the user to reconnect.
				if (isRateLimitResponse({ status: status, message: normalizedError.message })) {
					throw toRateLimitError(normalizedError, token);
				}
				throw new AuthenticationError(
					tokenInfo,
					status === 401 ? AuthenticationErrorReason.Unauthorized : AuthenticationErrorReason.Forbidden,
					normalizedError,
				);
			default:
				if (status >= 400 && status < 500) {
					throw new RequestClientError(normalizedError);
				}
		}
	}

	throw error;
}

/** Extracts the useful provider prose from an already-parsed SDK response body. */
export function getProviderResponseBodyMessage(body: unknown): string | undefined {
	let message: string | undefined;
	if (typeof body === 'string') {
		message = body;
	} else if (body != null && typeof body === 'object') {
		const { message: direct, error } = body as { message?: unknown; error?: unknown };
		if (typeof direct === 'string') {
			message = direct;
		} else if (typeof error === 'string') {
			message = error;
		} else if (error != null && typeof error === 'object') {
			const nested = (error as { message?: unknown }).message;
			if (typeof nested === 'string') {
				message = nested;
			}
		}
		if (message == null) {
			const graphQLError = getProviderGraphQLErrors(body)[0];
			if (typeof graphQLError?.message === 'string') {
				message = graphQLError.message;
			} else if (typeof graphQLError?.extensions?.code === 'string') {
				message = graphQLError.extensions.code;
			}
		}
	}

	message = message?.trim();
	return message ? message.slice(0, maxProviderErrorBodyLength) : undefined;
}
