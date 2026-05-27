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
			case AIErrorReason.NoNetwork:
				message = 'Unable to reach the AI service. Please check your internet connection.';
				break;
			case AIErrorReason.Unreachable:
				message = 'The AI service is temporarily unreachable.';
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

export class AuthenticationRequiredError extends Error {
	constructor() {
		super('Authentication required');

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
