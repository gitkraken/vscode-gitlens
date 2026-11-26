import type { AzurePullRequestWriteFailure } from '../models/azurePullRequestWrites.js';
import {
	AnonymousResponseError,
	getProviderResponseBodyMessage,
	UnexpectedHtmlResponseError,
} from './providerErrors.js';

export class AzurePullRequestWriteError extends Error {
	constructor(readonly reason: AzurePullRequestWriteFailure['reason']) {
		super(reason);
	}
}

export function toAzurePullRequestWriteFailure(
	ex: unknown,
	dispatched?: { complete: boolean },
): AzurePullRequestWriteFailure {
	if (ex instanceof AzurePullRequestWriteError) return { ok: false, reason: ex.reason };

	const response = (ex as { response?: { status?: number; body?: unknown } } | undefined)?.response;
	const status = response?.status;
	const ambiguous = dispatched == null ? 'unknown' : 'outcome-unknown';
	if (UnexpectedHtmlResponseError.is(ex) || AnonymousResponseError.is(ex)) {
		return { ok: false, reason: dispatched == null ? 'no-connection' : ambiguous };
	}

	const body = response?.body;
	const type = (body as { typeKey?: unknown } | undefined)?.typeKey;
	const message = getProviderResponseBodyMessage(body) ?? '';
	if (status === 400 || status === 403 || status === 409 || status === 422) {
		if (
			dispatched?.complete &&
			(/(?:branch policies|policy requirements|required reviewers?|required approvals?) (?:have not been|are not|are still not) (?:met|satisfied|approved)|TF402455\b/i.test(
				message,
			) ||
				(typeof type === 'string' && /^(?:Git)?PullRequest.*Policy.*Exception$/.test(type)))
		) {
			return { ok: false, reason: 'policy-blocked' };
		}

		if (dispatched?.complete && /\bsource branch (?:has changed|was updated)\b/i.test(message)) {
			return { ok: false, reason: 'source-changed' };
		}

		if (type === 'GitPullRequestExistsException' || /\bTF401179\b/.test(message)) {
			return { ok: false, reason: 'conflict' };
		}
	}

	let reason: AzurePullRequestWriteFailure['reason'];
	switch (status) {
		case 400:
		case 413:
		case 422:
			reason = 'invalid-input';
			break;
		case 401:
			reason = dispatched == null ? 'no-connection' : 'forbidden';
			break;
		case 403:
			reason = 'forbidden';
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
			reason = ambiguous;
	}

	return { ok: false, reason: reason };
}
