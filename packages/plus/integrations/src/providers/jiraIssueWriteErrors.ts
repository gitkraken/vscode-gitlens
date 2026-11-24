import type { IssueTrackerWriteFailure } from '../models/issueTrackerWrites.js';
import { getProviderResponseBodyMessage } from './providerErrors.js';

export class JiraIssueWriteError extends Error {
	constructor(
		readonly reason: IssueTrackerWriteFailure['reason'],
		readonly fieldErrors?: Record<string, string>,
	) {
		super(reason);
	}
}

function statusOf(ex: unknown): number | undefined {
	const status = (ex as { response?: { status?: unknown } } | null | undefined)?.response?.status;
	return typeof status === 'number' ? status : undefined;
}

export function toJiraIssueWriteFailure(ex: unknown, dispatched = false): IssueTrackerWriteFailure {
	if (ex instanceof JiraIssueWriteError) {
		return {
			ok: false,
			reason: ex.reason,
			mutationDispatched: false,
			...(ex.fieldErrors && { fieldErrors: ex.fieldErrors }),
		};
	}

	const status = statusOf(ex);
	const body = (ex as { response?: { body?: unknown } } | null | undefined)?.response?.body;
	const error = body as { errors?: unknown; errorMessages?: unknown } | undefined;
	const messages = Array.isArray(error?.errorMessages)
		? error.errorMessages.filter((message): message is string => typeof message === 'string')
		: [];
	const hasScopeMismatch =
		status === 401 &&
		[getProviderResponseBodyMessage(body), ...messages].some(message =>
			/scope does not match|insufficient.scope/i.test(message ?? ''),
		);
	let reason: IssueTrackerWriteFailure['reason'];
	switch (status) {
		case 400:
		case 413:
		case 422:
			reason = 'invalid-input';
			break;
		case 401:
			reason = hasScopeMismatch ? 'insufficient-scope' : 'no-connection';
			break;
		case 403:
			reason = 'forbidden';
			break;
		case 404:
			reason = 'not-found';
			break;
		case 409:
			reason = 'conflict';
			break;
		case 429:
			reason = 'rate-limit';
			break;
		default:
			reason = 'unknown';
	}

	const failure: IssueTrackerWriteFailure = { ok: false, reason: reason };
	if (!dispatched) {
		failure.mutationDispatched = false;
	} else if (reason === 'unknown') {
		failure.applied = 'maybe';
	}
	if (reason === 'invalid-input') {
		const fieldErrors = Object.fromEntries(
			Object.entries(typeof error?.errors === 'object' && error.errors != null ? error.errors : {}).filter(
				(entry): entry is [string, string] => typeof entry[1] === 'string',
			),
		);
		if (Object.keys(fieldErrors).length !== 0) {
			failure.fieldErrors = fieldErrors;
		}
		if (messages.length !== 0) {
			failure.messages = messages;
		}
	}
	return failure;
}
