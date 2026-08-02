import type {
	CollectionMetadata,
	CollectionOmission,
	CollectionScope,
	CollectionScopeFailure,
} from '@gitkraken/provider-apis';
import { AuthenticationError, RequestNotFoundError, RequestRateLimitError } from '@gitlens/git/errors.js';
import type { IntegrationIds } from './constants.js';
import { isRateLimitResponse } from './errors.js';
import type { ProviderWarning, ProviderWarningOmission } from './results.js';
import { appendDedupedWarning } from './results.js';

/**
 * Maps a caught GitLens request error to the SDK collection failure vocabulary used inside provider fan-outs.
 */
export function toCollectionFailureKind(ex: unknown): CollectionScopeFailure['kind'] {
	if (ex instanceof AuthenticationError) return 'authentication';
	if (ex instanceof RequestRateLimitError) return 'rate-limit';
	if (ex instanceof RequestNotFoundError) return 'not-found';
	return 'provider';
}

/** Builds a structured SDK scope failure from a caught GitLens request error. */
export function toCollectionScopeFailure(scope: CollectionScopeFailure['scope'], ex: unknown): CollectionScopeFailure {
	return {
		scope: scope,
		kind: toCollectionFailureKind(ex),
		...(ex instanceof Error && ex.message ? { message: ex.message } : {}),
	};
}

function collectionFailureKindToWarningKind(kind: CollectionScopeFailure['kind']): ProviderWarning['kind'] {
	switch (kind) {
		case 'authentication':
			return 'auth';
		case 'rate-limit':
			return 'rate-limit';
		case 'not-found':
			return 'not-found';
		default:
			return 'other';
	}
}

function getCollectionFailureStatus(message: string | undefined): number | undefined {
	if (message == null) return undefined;

	const match = /\((\d{3})\)/.exec(message) ?? /^(?:HTTP\s+)?(\d{3})\b/i.exec(message.trim());
	return match != null ? Number(match[1]) : undefined;
}

function toCollectionFailureWarningKind(failure: CollectionScopeFailure): ProviderWarning['kind'] {
	const mapped = collectionFailureKindToWarningKind(failure.kind);
	if (mapped !== 'other' || (failure.kind !== 'provider' && failure.kind !== 'unknown')) return mapped;

	// provider-apis currently groups several HTTP statuses under `provider` in partial fan-outs. The custom
	// fetch adapter retains the status in `message`, so recover the same neutral classification the thrown-error
	// path exposes instead of downgrading these structured failures to `other`.
	const status = getCollectionFailureStatus(failure.message);
	switch (status) {
		case 401:
			return 'auth';
		case 403:
			return isRateLimitResponse({ status: status, message: failure.message }) ? 'rate-limit' : 'auth';
		case 404:
		case 410:
		case 422:
			return 'not-found';
		case 429:
			return 'rate-limit';
		default:
			return mapped;
	}
}

/** ` (resource r, project p, repository o/n)` for the scope IDs present; empty when the scope names none. */
function collectionScopeText(scope: CollectionScope | undefined): string {
	const parts: string[] = [];
	if (scope?.resourceId != null) {
		parts.push(`resource ${scope.resourceId}`);
	}
	if (scope?.projectId != null) {
		parts.push(`project ${scope.projectId}`);
	}
	if (scope?.repositoryId != null) {
		parts.push(`repository ${scope.repositoryId}`);
	}

	return parts.length ? ` (${parts.join(', ')})` : '';
}

function collectionFailureMessage(failure: CollectionScopeFailure): string {
	const detail = failure.message != null ? `: ${failure.message}` : '';
	return `Failed to read ${failure.kind} scope${collectionScopeText(failure.scope)}${detail}`;
}

/**
 * Explains one omission in the consumer's terms — what was left out and, where the SDK reports it, how much.
 *
 * An omission is a completeness fact, never a failure: the read succeeded and the provider (or the SDK's own
 * recovery budget) is what withheld results, so retrying the same request cannot recover them. That is why
 * these never contribute to `fetchFailed`.
 */
function collectionOmissionMessage(omission: CollectionOmission): string {
	const scopeText = collectionScopeText(omission.scope);
	switch (omission.kind) {
		case 'provider-limit':
			// `totalCount` is the only figure saying how much was withheld; both fields are optional, so degrade
			// through the shapes the SDK can actually emit rather than printing `undefined`.
			if (omission.totalCount != null && omission.limit != null) {
				return `Search${scopeText} matched ${omission.totalCount} results, but the provider exposes at most ${omission.limit}`;
			}
			if (omission.limit != null) {
				return `Search${scopeText} exceeded the provider limit of ${omission.limit} results`;
			}
			return `Search${scopeText} exceeded the provider's result limit`;
		case 'recovery-budget':
			return `Stopped recovering omitted results${scopeText} after reaching the request budget${
				omission.limit != null ? ` of ${omission.limit} requests` : ''
			}`;
		case 'pagination-incomplete':
			return `More results are available${scopeText} than this read returned`;
		default:
			// `CollectionOmissionKind` is a closed union, so this is unreachable today. Kept as a compile-time
			// guard rather than a silent fallback: an SDK bump that adds a kind breaks the build here instead
			// of quietly degrading it to a vague message.
			omission.kind satisfies never;
			return `Some results were omitted${scopeText}; the read is incomplete`;
	}
}

/**
 * Forwards an SDK omission as the structured signal consumers read instead of parsing {@link
 * collectionOmissionMessage}'s prose.
 *
 * `results.ts` re-spells `CollectionOmissionKind` rather than importing it, so the published warning surface
 * carries no `@gitkraken/provider-apis` types (see the export block in `index.ts`). The return type is what
 * keeps the two unions honest: an SDK bump that adds a member fails to compile here, alongside
 * `collectionOmissionMessage`'s `satisfies never`.
 *
 * `scope` is copied because the SDK's own object is retained and re-merged across drained pages
 * (`providerPaging.ts`), and this one crosses the package boundary.
 */
function toProviderWarningOmission(omission: CollectionOmission): ProviderWarningOmission {
	return {
		kind: omission.kind,
		...(omission.limit != null ? { limit: omission.limit } : {}),
		// The SDK types this `number | null | undefined`; normalize to one absence for consumers.
		...(omission.totalCount != null ? { totalCount: omission.totalCount } : {}),
		...(omission.scope != null ? { scope: { ...omission.scope } } : {}),
	};
}

/**
 * Whether SDK metadata describes a read that may be missing results.
 *
 * A reported omission counts on its own rather than deferring to `completeness`. The SDK does couple the
 * two — every site that emits an omission degrades completeness in the same call — so today the omission
 * clause changes no outcome. It is defensive: the two facts arrive as independent fields, and a read that
 * names what it left out must not be publishable as whole if a future producer sets only one of them.
 *
 * This is the single definition of "may be missing results", shared with `getPagedResult`, so one metadata
 * object cannot be truncated at one layer and complete at another.
 */
export function isIncompleteCollection(metadata: CollectionMetadata | undefined): boolean {
	if (metadata == null) return false;

	return metadata.completeness !== 'complete' || (metadata.omissions?.length ?? 0) > 0;
}

/** Converts internal SDK collection metadata into neutral provider facade signals. */
export function assessCollectionMetadata(
	providerId: IntegrationIds,
	domain: string | undefined,
	connectionId: string | undefined,
	metadata: CollectionMetadata | undefined,
): { warnings: ProviderWarning[]; fetchFailed: boolean; truncated: boolean } {
	if (metadata == null) return { warnings: [], fetchFailed: false, truncated: false };

	const warnings: ProviderWarning[] = [];
	const failures = metadata.failures ?? [];
	for (const failure of failures) {
		const kind = toCollectionFailureWarningKind(failure);
		appendDedupedWarning(warnings, {
			providerId: providerId,
			domain: domain,
			connectionId: connectionId,
			message: collectionFailureMessage(failure),
			kind: kind,
			isAuth: kind === 'auth',
		});
	}

	// Omissions explain WHY a read is incomplete when nothing failed — a provider cap, an exhausted recovery
	// budget, an undrained scope. They classify as `other`, never `auth`, and are deliberately excluded from
	// `fetchFailed` below: the request succeeded, so a retry would return the same truncated set. `omission`
	// carries that same fact structurally, so a consumer can act on it without parsing the message.
	const omissions = metadata.omissions ?? [];
	for (const omission of omissions) {
		appendDedupedWarning(warnings, {
			providerId: providerId,
			domain: domain,
			connectionId: connectionId,
			message: collectionOmissionMessage(omission),
			kind: 'other',
			isAuth: false,
			omission: toProviderWarningOmission(omission),
		});
	}

	const incomplete = isIncompleteCollection(metadata);
	// Only fall back to the generic message when nothing more specific was reported; an omission already
	// explains the incompleteness in the consumer's terms, so adding this on top would be noise.
	//
	// This one deliberately carries no `omission`: it fires precisely when the SDK reported incompleteness
	// WITHOUT saying what was left out, so there is no structured fact to forward and synthesizing one would
	// assert a specificity this layer does not have.
	if (incomplete && failures.length === 0 && omissions.length === 0) {
		appendDedupedWarning(warnings, {
			providerId: providerId,
			domain: domain,
			connectionId: connectionId,
			message:
				metadata.completeness === 'partial'
					? 'Some results were omitted; the read is incomplete'
					: 'Result completeness could not be confirmed',
			kind: 'other',
			isAuth: false,
		});
	}

	return { warnings: warnings, fetchFailed: failures.length > 0, truncated: incomplete };
}

/** Appends neutral warnings derived from SDK metadata and returns its failure/truncation assessment. */
export function mergeAssessmentInto(
	warnings: ProviderWarning[],
	providerId: IntegrationIds,
	domain: string | undefined,
	connectionId: string | undefined,
	metadata: CollectionMetadata | undefined,
): { fetchFailed: boolean; truncated: boolean } {
	const assessment = assessCollectionMetadata(providerId, domain, connectionId, metadata);
	for (const warning of assessment.warnings) {
		appendDedupedWarning(warnings, warning);
	}
	return { fetchFailed: assessment.fetchFailed, truncated: assessment.truncated };
}
