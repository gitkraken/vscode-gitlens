export type { AuthTokenInfo } from '@gitlens/git/errors.js';
export {
	AuthenticationError,
	AuthenticationErrorReason,
	RequestClientError,
	RequestNotFoundError,
	RequestRateLimitError,
} from '@gitlens/git/errors.js';

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
