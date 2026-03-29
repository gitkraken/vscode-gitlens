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
