import type { TokenWithInfo } from '../authentication/models.js';
import type { IntegrationIds } from '../constants.js';
import { IssuesCloudHostIntegrationId } from '../constants.js';
import {
	AuthenticationError,
	AuthenticationErrorReason,
	isRateLimitResponse,
	RequestClientError,
	RequestNotFoundError,
	toError,
	toRateLimitError,
} from '../errors.js';

const linearIssueNotFoundMessage = /^Linear issue not found: .+$/i;
const maxProviderErrorBodyLength = 500;

type ProviderGraphQLError = {
	message?: unknown;
	extensions?: { code?: unknown };
};

function getProviderGraphQLErrors(body: unknown): ProviderGraphQLError[] {
	if (body == null || typeof body !== 'object') return [];

	const errors = (body as { errors?: unknown }).errors;
	return Array.isArray(errors)
		? errors.filter((error): error is ProviderGraphQLError => error != null && typeof error === 'object')
		: [];
}

function isLinearRateLimitError(providerId: IntegrationIds, ex: unknown): boolean {
	if (providerId !== IssuesCloudHostIntegrationId.Linear) return false;

	const body = (ex as { response?: { body?: unknown } }).response?.body;
	return getProviderGraphQLErrors(body).some(error => error.extensions?.code === 'RATELIMITED');
}

export function isProviderIssueNotFoundError(providerId: IntegrationIds, ex: unknown): boolean {
	if (providerId === IssuesCloudHostIntegrationId.Linear) {
		return ex instanceof Error && linearIssueNotFoundMessage.test(ex.message);
	}

	const status = (ex as { response?: { status?: unknown } }).response?.status;
	return status === 404 || status === 410 || status === 422;
}

export function throwProviderError(tokenWithInfo: TokenWithInfo, error: unknown): never {
	const { accessToken: token, ...tokenInfo } = tokenWithInfo;
	const providerId = tokenWithInfo.providerId;
	const normalizedError = toError(error);
	// Linear reports GraphQL throttling as HTTP 400, so its structured code must win over generic 4xx handling.
	if (isLinearRateLimitError(providerId, error)) {
		throw toRateLimitError(normalizedError, token);
	}

	const status = (error as { response?: { status?: unknown } }).response?.status;
	if (typeof status === 'number') {
		switch (status) {
			case 404:
			case 410:
			case 422:
				throw new RequestNotFoundError(normalizedError);
			case 429:
				throw toRateLimitError(normalizedError, token);
			case 401:
			case 403:
				// Some hosts overload 403 for throttling; classify that before asking the user to reconnect.
				if (isRateLimitResponse({ status: status, message: normalizedError.message })) {
					throw toRateLimitError(normalizedError, token);
				}
				throw new AuthenticationError(
					tokenInfo,
					status === 401 ? AuthenticationErrorReason.Unauthorized : AuthenticationErrorReason.Forbidden,
					normalizedError,
				);
			default:
				if (status >= 400 && status < 500) {
					throw new RequestClientError(normalizedError);
				}
		}
	}

	throw error;
}

/** Extracts the useful provider prose from an already-parsed SDK response body. */
export function getProviderResponseBodyMessage(body: unknown): string | undefined {
	let message: string | undefined;
	if (typeof body === 'string') {
		message = body;
	} else if (body != null && typeof body === 'object') {
		const { message: direct, error } = body as { message?: unknown; error?: unknown };
		if (typeof direct === 'string') {
			message = direct;
		} else if (typeof error === 'string') {
			message = error;
		} else if (error != null && typeof error === 'object') {
			const nested = (error as { message?: unknown }).message;
			if (typeof nested === 'string') {
				message = nested;
			}
		}
		if (message == null) {
			const graphQLError = getProviderGraphQLErrors(body)[0];
			if (typeof graphQLError?.message === 'string') {
				message = graphQLError.message;
			} else if (typeof graphQLError?.extensions?.code === 'string') {
				message = graphQLError.extensions.code;
			}
		}
	}

	message = message?.trim();
	return message ? message.slice(0, maxProviderErrorBodyLength) : undefined;
}
