export type { AuthTokenInfo } from '@gitlens/git/errors.js';
export {
	AuthenticationError,
	AuthenticationErrorReason,
	RequestClientError,
	RequestNotFoundError,
	RequestRateLimitError,
} from '@gitlens/git/errors.js';

import { RequestRateLimitError } from '@gitlens/git/errors.js';

/**
 * Thrown by a provider read when it can't produce a result for a reason that is NOT "the account is empty":
 * a prerequisite is missing (e.g. Trello has no app key) or a required scope can't be resolved (e.g. the
 * Linear viewer id, needed to scope "my issues"). Returning an empty/undefined result in these cases would be
 * indistinguishable from a genuinely empty account; throwing this lets the result cores recover it into an
 * `{ error }` the facade surfaces as a warning + `fetchFailed`.
 */
export class IntegrationReadUnavailableError extends Error {
	constructor(provider: string, reason: string) {
		super(`${provider} read unavailable: ${reason}`);
		Error.captureStackTrace?.(this, new.target);
	}
}

/**
 * Thrown by integration provider HTTP clients when an upstream request fails.
 */
export class ProviderFetchError extends Error {
	get status(): number {
		return this.response.status;
	}

	get statusText(): string {
		return this.response.statusText;
	}

	constructor(
		provider: string,
		public readonly response: Response,
		errors?: { message: string }[],
	) {
		super(
			`${provider} request failed: ${!response.ok ? `(${response.status}) ${response.statusText}. ` : ''}${
				errors?.length ? errors[0].message : ''
			}`,
		);

		Error.captureStackTrace?.(this, new.target);
	}
}

/**
 * Whether a provider's error response denotes a rate limit rather than a permission failure. Every host in use
 * signals it on an otherwise-ambiguous status (GitHub/GitLab on 403, Bitbucket/Azure likewise) and only says so
 * in the message body, so the message is the discriminant. Kept here, in one place, because the distinction is
 * consequential: a rate limit is retryable, while a permission failure is surfaced as `auth` and drives a
 * reconnect prompt — misclassifying one as the other asks the user to re-authenticate a healthy connection.
 */
export function isRateLimitResponse(ex: { status: number; message?: string }): boolean {
	// 429 is unambiguous. Otherwise match the phrasing hosts actually use: GitHub/Bitbucket "API rate limit
	// exceeded", GitLab "rate limit exceeded", Azure "Request was blocked due to exceeding usage of resource
	// 'RateLimit'" / "TF400733: The request has been canceled: Request was blocked due to exceeding usage".
	if (ex.status === 429) return true;

	const message = ex.message?.toLowerCase();
	return message != null && (message.includes('rate limit') || message.includes('ratelimit'));
}

/**
 * A response's headers as either a `fetch` `Headers` instance or the plain object an SDK error carries. Read via
 * duck-typing on `get` rather than `instanceof Headers`, so this works in both the Node and webworker builds
 * without depending on the global being present.
 */
type ResponseHeaders = Pick<Headers, 'get'> | Record<string, unknown>;

/**
 * Builds a {@link RequestRateLimitError} from a provider error response, reading the reset epoch from the
 * standard `x-ratelimit-reset` header when present. Accepts both header shapes in use: the `fetch` `Headers`
 * instance the direct clients get, and the plain object the SDK attaches to its errors.
 */
export function toRateLimitError(
	ex: Error & { response?: { headers?: ResponseHeaders } },
	token: string | undefined,
): RequestRateLimitError {
	const headers = ex.response?.headers as { get?: unknown } & Record<string, unknown>;
	const raw =
		headers == null
			? undefined
			: typeof headers.get === 'function'
				? (headers.get as (name: string) => string | null)('x-ratelimit-reset')
				: headers['x-ratelimit-reset'];

	// Only a header that actually came back as a string/number can be a reset epoch; anything else (a nested SDK
	// object, an array of values) would stringify to garbage and parse to NaN anyway.
	let resetAt: number | undefined;
	if (typeof raw === 'string' || typeof raw === 'number') {
		resetAt = parseInt(String(raw), 10);
		if (Number.isNaN(resetAt)) {
			resetAt = undefined;
		}
	}

	return new RequestRateLimitError(ex, token, resetAt);
}

/**
 * Normalizes a caught `unknown` into an `Error`. Result cores type their failure channel as `error: Error`,
 * but a `catch` binding is `unknown` and a provider (or a third-party SDK) can throw a non-Error value;
 * returning it raw would leak a non-Error through the public result surface and break downstream `instanceof`
 * classification. Passes an existing `Error` through unchanged and wraps anything else with `String(ex)`.
 */
export function toError(ex: unknown): Error {
	return ex instanceof Error ? ex : new Error(String(ex));
}
