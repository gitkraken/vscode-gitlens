import type { Uri } from 'vscode';
import { CancellationError as _CancellationError } from 'vscode';
import type { Response } from '@env/fetch';
import type { RequiredSubscriptionPlans, Subscription } from './subscription';
import { isSubscriptionPaidPlan } from './subscription';

export class AccessDeniedError extends Error {
	public readonly subscription: Subscription;
	public readonly required: RequiredSubscriptionPlans | undefined;

	constructor(subscription: Subscription, required: RequiredSubscriptionPlans | undefined) {
		let message;
		if (subscription.account?.verified === false) {
			message = 'Email verification required';
		} else if (required != null && isSubscriptionPaidPlan(required)) {
			message = 'Paid plan required';
		} else {
			message = 'Plan required';
		}

		super(message);

		this.subscription = subscription;
		this.required = required;
		Error.captureStackTrace?.(this, AccessDeniedError);
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
		Error.captureStackTrace?.(this, AccountValidationError);
	}
}

export const enum AuthenticationErrorReason {
	UserDidNotConsent = 1,
	Unauthorized = 2,
	Forbidden = 3,
}

export class AuthenticationError extends Error {
	readonly id: string;
	readonly original?: Error;
	readonly reason: AuthenticationErrorReason | undefined;

	constructor(id: string, reason?: AuthenticationErrorReason, original?: Error);
	constructor(id: string, message?: string, original?: Error);
	constructor(id: string, messageOrReason: string | AuthenticationErrorReason | undefined, original?: Error) {
		let message;
		let reason: AuthenticationErrorReason | undefined;
		if (messageOrReason == null) {
			message = `Unable to get required authentication session for '${id}'`;
		} else if (typeof messageOrReason === 'string') {
			message = messageOrReason;
			reason = undefined;
		} else {
			reason = messageOrReason;
			switch (reason) {
				case AuthenticationErrorReason.UserDidNotConsent:
					message = `'${id}' authentication is required for this operation`;
					break;
				case AuthenticationErrorReason.Unauthorized:
					message = `Your '${id}' credentials are either invalid or expired`;
					break;
				case AuthenticationErrorReason.Forbidden:
					message = `Your '${id}' credentials do not have the required access`;
					break;
			}
		}
		super(message);

		this.id = id;
		this.original = original;
		this.reason = reason;
		Error.captureStackTrace?.(this, AuthenticationError);
	}
}

export class CancellationError extends _CancellationError {
	constructor() {
		super();

		Error.captureStackTrace?.(this, CancellationError);
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

		Error.captureStackTrace?.(this, ExtensionNotFoundError);
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
		Error.captureStackTrace?.(this, OpenVirtualRepositoryError);
	}
}

export class ProviderFetchError extends Error {
	get status() {
		return this.response.status;
	}

	get statusText() {
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

		Error.captureStackTrace?.(this, ProviderFetchError);
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

		Error.captureStackTrace?.(this, ProviderNotFoundError);
	}
}

export class ProviderRequestClientError extends Error {
	constructor(public readonly original: Error) {
		super(original.message);

		Error.captureStackTrace?.(this, ProviderRequestClientError);
	}
}

export class ProviderRequestNotFoundError extends Error {
	constructor(public readonly original: Error) {
		super(original.message);

		Error.captureStackTrace?.(this, ProviderRequestNotFoundError);
	}
}

export class ProviderRequestRateLimitError extends Error {
	constructor(
		public readonly original: Error,
		public readonly token: string,
		public readonly resetAt: number | undefined,
	) {
		super(original.message);

		Error.captureStackTrace?.(this, ProviderRequestRateLimitError);
	}
}
