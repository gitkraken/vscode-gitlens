import type { IssueTrackerWriteFailure } from '../models/issueTrackerWrites.js';
import type { WorkItemWriteField, WorkItemWriteScope } from '../models/workItemWrites.js';
import {
	AnonymousResponseError,
	getProviderResponseBodyMessage,
	UnexpectedHtmlResponseError,
} from './providerErrors.js';

const guidPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

export function isWorkItemWriteScope(options: WorkItemWriteScope): boolean {
	return (
		isWorkItemIdentifier(options.connectionId) &&
		isGuid(options.organizationId) &&
		typeof options.organizationName === 'string' &&
		/^[a-z0-9][a-z0-9-]*$/i.test(options.organizationName) &&
		isGuid(options.projectId) &&
		(options.expectedAccountId === undefined || isWorkItemIdentifier(options.expectedAccountId))
	);
}

export function isGuid(value: unknown): value is string {
	return typeof value === 'string' && guidPattern.test(value);
}

export function isWorkItemIdentifier(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		value.trim() === value &&
		![...value].some(character => character < ' ' || character === '\x7f')
	);
}

export function isWorkItemNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647;
}

export class WorkItemWriteError extends Error {
	constructor(
		readonly reason: IssueTrackerWriteFailure['reason'],
		readonly fieldErrors?: Readonly<Record<string, string>>,
	) {
		super(reason);
	}
}

function getRuleErrors(body: unknown, fields: readonly WorkItemWriteField[]) {
	const data = body as
		| {
				ruleValidationErrors?: unknown;
				customProperties?: { ruleValidationErrors?: unknown; RuleValidationErrors?: unknown };
		  }
		| undefined;
	const rows =
		data?.ruleValidationErrors ??
		data?.customProperties?.ruleValidationErrors ??
		data?.customProperties?.RuleValidationErrors;
	const message = getProviderResponseBodyMessage(body);
	const messages = new Set<string>();
	const fieldErrors = new Map<string, string>();
	if (message) {
		messages.add(message);
	}

	if (Array.isArray(rows)) {
		for (const row of rows) {
			const error = row as { fieldReferenceName?: unknown; errorMessage?: unknown } | null;
			if (typeof error?.errorMessage !== 'string') continue;

			messages.add(error.errorMessage);
			if (typeof error.fieldReferenceName === 'string') {
				fieldErrors.set(error.fieldReferenceName, error.errorMessage);
			}
		}
	}

	const fieldName = /TF401320:\s*Rule Error for field (.+?)\.\s+Error code:/i.exec(message ?? '')?.[1];
	if (fieldName != null) {
		const matches = fields.filter(field => field.name === fieldName || field.referenceName === fieldName);
		if (matches.length === 1 && message && !fieldErrors.has(matches[0].referenceName)) {
			fieldErrors.set(matches[0].referenceName, message);
		}
	}
	return {
		...(messages.size && { messages: [...messages] }),
		...(fieldErrors.size && { fieldErrors: Object.fromEntries(fieldErrors) }),
	};
}

export function toWorkItemWriteFailure(
	ex: unknown,
	dispatched?: { fields: readonly WorkItemWriteField[] },
): IssueTrackerWriteFailure {
	if (ex instanceof WorkItemWriteError && dispatched == null) {
		return {
			ok: false,
			reason: ex.reason,
			mutationDispatched: false,
			...(ex.fieldErrors && { fieldErrors: ex.fieldErrors }),
		};
	}

	if (dispatched == null && (UnexpectedHtmlResponseError.is(ex) || AnonymousResponseError.is(ex))) {
		return { ok: false, reason: 'no-connection', mutationDispatched: false };
	}

	const response = (
		ex as
			| {
					response?: { status?: number; body?: unknown; headers?: Record<string, string> };
			  }
			| undefined
	)?.response;
	const status = response?.status;
	const body = response?.body;
	const type = (body as { typeKey?: unknown } | undefined)?.typeKey;
	const message = getProviderResponseBodyMessage(body) ?? '';
	let reason: IssueTrackerWriteFailure['reason'];
	switch (status) {
		case 400:
		case 413:
		case 422:
			reason = type === 'WorkItemRevisionMismatchException' ? 'conflict' : 'invalid-input';
			break;
		case 401:
		case 403:
			if (
				/\binsufficient[_ -]scope\b|scope does not match|\bvso\.work_write\b/i.test(
					`${response?.headers?.['www-authenticate'] ?? ''} ${message}`,
				)
			) {
				reason = 'insufficient-scope';
			} else {
				reason = status === 401 && dispatched == null ? 'no-connection' : 'forbidden';
			}
			break;
		case 404:
			reason = 'not-found';
			break;
		case 409:
		case 412:
			reason = 'conflict';
			break;
		case 429:
			reason = 'rate-limit';
			break;
		default:
			reason = 'unknown';
	}

	return {
		ok: false,
		reason: reason,
		...(dispatched == null && { mutationDispatched: false }),
		...(dispatched != null && reason === 'unknown' && { applied: 'maybe' }),
		...(reason === 'invalid-input' && getRuleErrors(body, dispatched?.fields ?? [])),
	};
}
