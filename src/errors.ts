import type { Uri } from 'vscode';
import { AuthenticationError } from '@gitlens/git/errors.js';
import type { RequiredSubscriptionPlanIds, Subscription } from './plus/gk/models/subscription.js';
import { isSubscriptionPaidPlan } from './plus/gk/utils/subscription.utils.js';

export type { AuthTokenInfo } from '@gitlens/git/errors.js';
export { AuthenticationError, AuthenticationErrorReason } from '@gitlens/git/errors.js';
export { RequestClientError, RequestNotFoundError, RequestRateLimitError } from '@gitlens/git/errors.js';
export {
	AIError,
	AIErrorReason,
	AINoRequestDataError,
	AuthenticationRequiredError,
	classifyNetworkError,
} from '@gitlens/ai/errors.js';

export class AccessDeniedError extends Error {
	public readonly subscription: Subscription;
	public readonly required: RequiredSubscriptionPlanIds | undefined;

	constructor(subscription: Subscription, required: RequiredSubscriptionPlanIds | undefined) {
		let message;
		if (subscription.account?.verified === false) {
			message = 'Email verification required';
		} else if (required != null && isSubscriptionPaidPlan(required)) {
			message = 'GitLens Pro required';
		} else {
			message = 'Plan required';
		}

		super(message);

		this.subscription = subscription;
		this.required = required;
		Error.captureStackTrace?.(this, new.target);
	}
}

export class AccountValidationError extends Error {
	readonly original?: Error;
	readonly statusCode?: number;
	readonly statusText?: string;

	constructor(message: string, original?: Error, statusCode?: number, statusText?: string) {
		message += `; status=${statusCode}: ${statusText}`;
		super(message);

		this.original = original;
		this.statusCode = statusCode;
		this.statusText = statusText;
		Error.captureStackTrace?.(this, new.target);
	}
}

export class ExtensionNotFoundError extends Error {
	constructor(
		public readonly extensionId: string,
		public readonly extensionName: string,
	) {
		super(
			`Unable to find the ${extensionName} extension (${extensionId}). Please ensure it is installed and enabled.`,
		);

		Error.captureStackTrace?.(this, new.target);
	}
}

export const enum OpenVirtualRepositoryErrorReason {
	RemoteHubApiNotFound = 1,
	NotAGitHubRepository = 2,
	GitHubAuthenticationNotFound = 3,
	GitHubAuthenticationDenied = 4,
}

export class OpenVirtualRepositoryError extends Error {
	readonly original?: Error;
	readonly reason: OpenVirtualRepositoryErrorReason | undefined;
	readonly repoPath: string;

	constructor(repoPath: string, reason?: OpenVirtualRepositoryErrorReason, original?: Error);
	constructor(repoPath: string, message?: string, original?: Error);
	constructor(
		repoPath: string,
		messageOrReason: string | OpenVirtualRepositoryErrorReason | undefined,
		original?: Error,
	) {
		let message;
		let reason: OpenVirtualRepositoryErrorReason | undefined;
		if (messageOrReason == null) {
			message = `Unable to open the virtual repository: ${repoPath}`;
		} else if (typeof messageOrReason === 'string') {
			message = messageOrReason;
			reason = undefined;
		} else {
			reason = messageOrReason;
			message = `Unable to open the virtual repository: ${repoPath}; `;
			switch (reason) {
				case OpenVirtualRepositoryErrorReason.RemoteHubApiNotFound:
					message +=
						'Unable to get required api from the GitHub Repositories extension. Please ensure that the GitHub Repositories extension is installed and enabled';
					break;
				case OpenVirtualRepositoryErrorReason.NotAGitHubRepository:
					message += 'Only GitHub repositories are supported currently';
					break;
				case OpenVirtualRepositoryErrorReason.GitHubAuthenticationNotFound:
					message += 'Unable to get required GitHub authentication';
					break;
				case OpenVirtualRepositoryErrorReason.GitHubAuthenticationDenied:
					message += 'GitHub authentication is required';
					break;
			}
		}
		super(message);

		this.original = original;
		this.reason = reason;
		this.repoPath = repoPath;
		Error.captureStackTrace?.(this, new.target);
	}
}

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

export class ProviderNotFoundError extends Error {
	constructor(pathOrUri: string | Uri | undefined) {
		super(
			`No provider registered for '${
				pathOrUri == null
					? String(pathOrUri)
					: typeof pathOrUri === 'string'
						? pathOrUri
						: pathOrUri.toString(true)
			}'`,
		);

		Error.captureStackTrace?.(this, new.target);
	}
}

export class ProviderNotSupportedError extends Error {
	constructor(provider: string) {
		super(`Action is not supported on the ${provider} provider.`);

		Error.captureStackTrace?.(this, new.target);
	}
}

export class RequestGoneError extends Error {
	constructor(public readonly original: Error) {
		super(original.message);

		Error.captureStackTrace?.(this, new.target);
	}
}

export class RequestUnprocessableEntityError extends Error {
	constructor(public readonly original: Error) {
		super(original.message);

		Error.captureStackTrace?.(this, new.target);
	}
}

export class RequestsAreBlockedTemporarilyError extends Error {
	constructor() {
		super('Requests are blocked');

		Error.captureStackTrace?.(this, new.target);
	}
}

export class RequiresIntegrationError extends Error {
	constructor(message: string) {
		super(message);
		Error.captureStackTrace?.(this, new.target);
	}
}

/**
 * Gets a error message string suitable for user-facing UI and telemetry.
 * For AuthenticationError instances, returns just the message property to avoid
 * exposing technical token details (microHash, scopes, expiresAt).
 * For all other errors, returns the string representation.
 */
export function getPresentableErrorMessage(error: Error | unknown): string {
	if (error instanceof AuthenticationError) {
		// avoid exposing sensitive token details: microHash, scopes, expiresAt.
		return error.message;
	}
	return String(error);
}
