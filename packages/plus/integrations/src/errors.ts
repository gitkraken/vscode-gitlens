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

	/**
	 * Builds the error with the upstream body folded into the message, for clients that hold a `Response` whose
	 * body has not been read (i.e. every non-`ok` path). Use this rather than the constructor whenever the body is
	 * still available: the status line alone cannot distinguish a throttled request from a permission failure on
	 * the statuses hosts overload (see {@link isRateLimitResponse}), and only the body says which one it is.
	 *
	 * Never throws: the body is best-effort, so an unreadable, empty, or already-consumed one simply yields the
	 * status-line-only message the constructor would have produced.
	 */
	static async fromResponse(provider: string, response: Response): Promise<ProviderFetchError> {
		return new ProviderFetchError(provider, response, await readErrorBodyMessage(response));
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

/** Cap on the body text folded into an error message, so an HTML error page can't become the message. */
const maxErrorBodyLength = 500;

/**
 * Best-effort human-readable message from an error response body, in the `errors` shape the
 * {@link ProviderFetchError} constructor takes. Tolerant by design — every host in use words its errors
 * differently and some do not send JSON at all:
 *   - Azure DevOps — `{ message: "TF400733: ..." }`
 *   - Bitbucket    — `{ error: { message: "..." } }`, and bare text for a throttled request
 *   - GitLab       — `{ message: "..." }` or `{ error: "..." }`
 * Anything unrecognized falls back to the raw text, which is what the substring check wants anyway.
 */
async function readErrorBodyMessage(response: Response): Promise<{ message: string }[] | undefined> {
	let text;
	try {
		// `bodyUsed` is not a guarantee (a stream can fail mid-read), hence the catch — but it avoids the throw
		// entirely on the common path where something upstream already consumed the body.
		if (response.bodyUsed) return undefined;

		text = (await response.text())?.trim();
	} catch {
		return undefined;
	}
	if (!text) return undefined;

	let message: string | undefined;
	try {
		const body: unknown = JSON.parse(text);
		if (body != null && typeof body === 'object') {
			const { message: m, error } = body as { message?: unknown; error?: unknown };
			if (typeof m === 'string') {
				message = m;
			} else if (typeof error === 'string') {
				message = error;
			} else if (error != null && typeof error === 'object' && typeof (error as any).message === 'string') {
				message = (error as { message: string }).message;
			}
		}
	} catch {
		// Not JSON — Bitbucket sends bare text for a throttled request, and any host can send an HTML error page.
	}

	message = (message ?? text).trim();
	return message ? [{ message: message.slice(0, maxErrorBodyLength) }] : undefined;
}

/**
 * Whether a provider's error response denotes a rate limit rather than a permission failure. Kept here, in one
 * place, because the distinction is consequential: a rate limit is retryable, while a permission failure is
 * surfaced as `auth` and drives a reconnect prompt — misclassifying one as the other asks the user to
 * re-authenticate a perfectly healthy connection.
 *
 * Which status a throttled request arrives on varies by host, which is why this takes both:
 *   - Azure DevOps and Bitbucket Cloud document 429 (learn.microsoft.com .../integrate/concepts/rate-limits).
 *   - GitHub documents "a `403` or `429` response" for both its primary and secondary limits
 *     (docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).
 *   - GitLab uses 403 for some throttles.
 * So 429 alone is decisive, and on 403 the message decides.
 *
 * NOTE the message must actually carry the host's body for the 403 path to work — see
 * {@link ProviderFetchError.fromResponse}. A `ProviderFetchError` built from the status line alone reads
 * "(403) Forbidden." and can never match, which is what made this check dead code on the direct-fetch clients.
 */
export function isRateLimitResponse(ex: { status: number; message?: string }): boolean {
	// Matches the phrasing hosts actually use: GitHub/Bitbucket "API rate limit exceeded", GitLab "rate limit
	// exceeded", Azure "Request was blocked due to exceeding usage of resource 'RateLimit'" / "TF400733: The
	// request has been canceled: Request was blocked due to exceeding usage".
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
