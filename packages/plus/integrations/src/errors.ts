export type { AuthTokenInfo } from '@gitlens/git/errors.js';
export {
	AuthenticationError,
	AuthenticationErrorReason,
	RequestClientError,
	RequestNotFoundError,
	RequestRateLimitError,
} from '@gitlens/git/errors.js';

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
