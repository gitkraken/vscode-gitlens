import type { Uri } from 'vscode';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { CancellationError as _CancellationError } from 'vscode';
import type { Response } from '@env/fetch.js';
import type { RequiredSubscriptionPlanIds, Subscription } from './plus/gk/models/subscription.js';
import { isSubscriptionPaidPlan } from './plus/gk/utils/subscription.utils.js';
import type { TokenInfo } from './plus/integrations/authentication/models.js';

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

export const enum AuthenticationErrorReason {
	UserDidNotConsent = 1,
	Unauthorized = 2,
	Forbidden = 3,
}

export class AuthenticationError extends Error {
	readonly id: string;
	readonly original?: Error;
	readonly reason: AuthenticationErrorReason | undefined;
	readonly authInfo: string;

	constructor(info: TokenInfo, reason?: AuthenticationErrorReason, original?: Error);
	constructor(info: TokenInfo, message?: string, original?: Error);
	constructor(info: TokenInfo, messageOrReason: string | AuthenticationErrorReason | undefined, original?: Error) {
		const { providerId: id, type, cloud, scopes, expiresAt } = info;
		const tokenDetails = [
			cloud ? 'cloud' : 'self-managed',
			type,
			info.microHash,
			expiresAt && `expiresAt=${isNaN(expiresAt.getTime()) ? expiresAt.toString() : expiresAt.toISOString()}`,
			scopes && `[${scopes.join(',')}]`,
		]
			.filter(v => v)
			.join(', ');
		const authInfo = `(token details: ${tokenDetails})`;
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
		this.authInfo = authInfo;
		Error.captureStackTrace?.(this, new.target);
	}

	override toString(): string {
		return `${super.toString()} ${this.authInfo}`;
	}
}

export class AuthenticationRequiredError extends Error {
	constructor() {
		super('Authentication required');

		Error.captureStackTrace?.(this, new.target);
	}
}

export class CancellationError extends _CancellationError {
	constructor(public readonly original?: Error) {
		super();

		if (this.original) {
			if (this.original.message.startsWith('Operation cancelled')) {
				this.message = this.original.message;
			} else {
				this.message = `Operation cancelled; ${this.original.message}`;
			}
		} else {
			this.message = 'Operation cancelled';
		}
		Error.captureStackTrace?.(this, new.target);
	}
}

export function isCancellationError(ex: unknown): ex is CancellationError {
	return ex instanceof CancellationError || ex instanceof _CancellationError;
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

export class RequestClientError extends Error {
	constructor(public readonly original: Error) {
		super(original.message);

		Error.captureStackTrace?.(this, new.target);
	}
}

export class RequestNotFoundError extends Error {
	constructor(public readonly original: Error) {
		super(original.message);

		Error.captureStackTrace?.(this, new.target);
	}
}

export class RequestRateLimitError extends Error {
	constructor(
		public readonly original: Error,
		public readonly token: string | undefined,
		public readonly resetAt: number | undefined,
	) {
		super(original.message);

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

export const enum AIErrorReason {
	DeniedByOrganization,
	DeniedByUser,
	NoEntitlement,
	NoRequestData,
	RateLimitExceeded,
	RateLimitOrFundsExceeded,
	RequestTooLarge,
	ModelNotSupported,
	ServiceCapacityExceeded,
	Unauthorized,
	UserQuotaExceeded,
}

export class AIError extends Error {
	readonly original?: Error;
	readonly reason: AIErrorReason | undefined;

	constructor(reason: AIErrorReason, original?: Error) {
		let message;
		switch (reason) {
			case AIErrorReason.NoEntitlement:
				message = 'You do not have the required entitlement to use this feature';
				break;
			case AIErrorReason.RequestTooLarge:
				message = 'The request is too large';
				break;
			case AIErrorReason.UserQuotaExceeded:
				message = 'You have exceeded your user token limit';
				break;
			case AIErrorReason.RateLimitExceeded:
				message = 'Rate limit exceeded';
				break;
			case AIErrorReason.RateLimitOrFundsExceeded:
				message = 'Rate limit exceeded or your account is out of funds';
				break;
			case AIErrorReason.ServiceCapacityExceeded:
				message = 'Service capacity exceeded';
				break;
			case AIErrorReason.NoRequestData:
				message = original?.message ?? 'No data was provided for the request';
				break;
			case AIErrorReason.ModelNotSupported:
				message = 'Model not supported for this request';
				break;
			case AIErrorReason.Unauthorized:
				message = 'You are not authorized to use the specified provider or model';
				break;
			case AIErrorReason.DeniedByOrganization:
				message = 'Your organization has denied access to the specified provider or model';
				break;
			case AIErrorReason.DeniedByUser:
				message = 'You have denied access to the specified provider or model';
				break;
			default:
				message = original?.message ?? 'An unknown error occurred';
				break;
		}

		super(message);

		this.original = original;
		this.reason = reason;
		Error.captureStackTrace?.(this, new.target);
	}
}

export class AINoRequestDataError extends AIError {
	constructor(message?: string) {
		super(AIErrorReason.NoRequestData, message ? new Error(message) : undefined);

		Error.captureStackTrace?.(this, new.target);
	}
}
