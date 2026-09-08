import * as l10n from '@vscode/l10n';

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
	NoNetwork,
	Unreachable,
}

export class AIError extends Error {
	readonly diagnosticMessage: string;
	readonly original?: Error;
	readonly reason: AIErrorReason | undefined;

	constructor(reason: AIErrorReason, original?: Error) {
		let message: string;
		let diagnosticMessage: string;
		switch (reason) {
			case AIErrorReason.NoEntitlement:
				diagnosticMessage = 'You do not have the required entitlement to use this feature';
				message = l10n.t('You do not have the required entitlement to use this feature');
				break;
			case AIErrorReason.RequestTooLarge:
				diagnosticMessage = 'The request is too large';
				message = l10n.t('The request is too large');
				break;
			case AIErrorReason.UserQuotaExceeded:
				diagnosticMessage = 'You have exceeded your user token limit';
				message = l10n.t('You have exceeded your user token limit');
				break;
			case AIErrorReason.RateLimitExceeded:
				diagnosticMessage = 'Rate limit exceeded';
				message = l10n.t('Rate limit exceeded');
				break;
			case AIErrorReason.RateLimitOrFundsExceeded:
				diagnosticMessage = 'Rate limit exceeded or your account is out of funds';
				message = l10n.t('Rate limit exceeded or your account is out of funds');
				break;
			case AIErrorReason.ServiceCapacityExceeded:
				diagnosticMessage = 'Service capacity exceeded';
				message = l10n.t('Service capacity exceeded');
				break;
			case AIErrorReason.NoNetwork:
				diagnosticMessage = 'Unable to reach the AI service. Please check your internet connection.';
				message = l10n.t('Unable to reach the AI service. Please check your internet connection.');
				break;
			case AIErrorReason.Unreachable:
				diagnosticMessage = 'The AI service is temporarily unreachable.';
				message = l10n.t('The AI service is temporarily unreachable.');
				break;
			case AIErrorReason.NoRequestData:
				diagnosticMessage = original?.message ?? 'No data was provided for the request';
				message = original?.message ?? l10n.t('No data was provided for the request');
				break;
			case AIErrorReason.ModelNotSupported:
				diagnosticMessage = 'Model not supported for this request';
				message = l10n.t('Model not supported for this request');
				break;
			case AIErrorReason.Unauthorized:
				diagnosticMessage = 'You are not authorized to use the specified provider or model';
				message = l10n.t('You are not authorized to use the specified provider or model');
				break;
			case AIErrorReason.DeniedByOrganization:
				diagnosticMessage = 'Your organization has denied access to the specified provider or model';
				message = l10n.t('Your organization has denied access to the specified provider or model');
				break;
			case AIErrorReason.DeniedByUser:
				diagnosticMessage = 'You have denied access to the specified provider or model';
				message = l10n.t('You have denied access to the specified provider or model');
				break;
			default:
				diagnosticMessage = original?.message ?? 'An unknown error occurred';
				message = original?.message ?? l10n.t('An unknown error occurred');
				break;
		}

		super(message);

		this.diagnosticMessage = diagnosticMessage;
		this.original = original;
		this.reason = reason;
		Error.captureStackTrace?.(this, new.target);
	}

	get diagnosticString(): string {
		return `${this.name}: ${this.diagnosticMessage}`;
	}
}

export class AuthenticationRequiredError extends Error {
	constructor() {
		super(l10n.t('Authentication required'));

		Error.captureStackTrace?.(this, new.target);
	}
}

export class AINoRequestDataError extends AIError {
	constructor(message?: string) {
		super(AIErrorReason.NoRequestData, message ? new Error(message) : undefined);

		Error.captureStackTrace?.(this, new.target);
	}
}

const noNetworkErrorCodes = new Set([
	'ENOTFOUND',
	'ECONNREFUSED',
	'EAI_AGAIN',
	'EHOSTUNREACH',
	'ENETUNREACH',
	'ENETDOWN',
	'UND_ERR_CONNECT_TIMEOUT',
]);

const unreachableErrorCodes = new Set(['ECONNRESET', 'ETIMEDOUT', 'UND_ERR_SOCKET']);

export function classifyNetworkError(ex: unknown): AIErrorReason.NoNetwork | AIErrorReason.Unreachable | undefined {
	let current: unknown = ex;
	let sawFetchFailed = false;
	for (let depth = 0; depth < 5 && current != null; depth++) {
		if (!(current instanceof Error)) break;

		if (current.name === 'TypeError' && current.message === 'fetch failed') {
			sawFetchFailed = true;
		}
		const code = (current as { code?: unknown }).code;
		if (typeof code === 'string') {
			if (noNetworkErrorCodes.has(code)) return AIErrorReason.NoNetwork;
			if (unreachableErrorCodes.has(code)) return AIErrorReason.Unreachable;
		}

		current = (current as { cause?: unknown }).cause;
	}
	return sawFetchFailed ? AIErrorReason.NoNetwork : undefined;
}

/**
 * Whether an error means AI itself is unavailable, rather than this particular request being
 * unacceptable. The distinction matters to any caller running a loop: an unavailable-AI failure will
 * repeat identically for every remaining item, so the loop should stop and say so, while a
 * request-shaped failure (too large, no data) may well succeed on the next item.
 *
 * `RequestTooLarge` and `NoRequestData` are therefore deliberately excluded — they're properties of
 * the one request that failed.
 */
export function isAIUnavailableError(ex: unknown): ex is AIError {
	if (!(ex instanceof AIError)) return false;

	switch (ex.reason) {
		case AIErrorReason.DeniedByOrganization:
		case AIErrorReason.DeniedByUser:
		case AIErrorReason.NoEntitlement:
		case AIErrorReason.RateLimitExceeded:
		case AIErrorReason.RateLimitOrFundsExceeded:
		case AIErrorReason.ServiceCapacityExceeded:
		case AIErrorReason.Unauthorized:
		case AIErrorReason.UserQuotaExceeded:
		case AIErrorReason.NoNetwork:
		case AIErrorReason.Unreachable:
		case AIErrorReason.ModelNotSupported:
			return true;
		default:
			return false;
	}
}
