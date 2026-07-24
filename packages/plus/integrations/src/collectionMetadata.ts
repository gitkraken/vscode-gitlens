import type { CollectionMetadata, CollectionScopeFailure } from '@gitkraken/provider-apis';
import { AuthenticationError, RequestNotFoundError, RequestRateLimitError } from '@gitlens/git/errors.js';
import type { IntegrationIds } from './constants.js';
import type { ProviderWarning } from './results.js';
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

function collectionFailureMessage(failure: CollectionScopeFailure): string {
	const scope = failure.scope;
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

	const scopeText = parts.length ? ` (${parts.join(', ')})` : '';
	const detail = failure.message != null ? `: ${failure.message}` : '';
	return `Failed to read ${failure.kind} scope${scopeText}${detail}`;
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
		const kind = collectionFailureKindToWarningKind(failure.kind);
		appendDedupedWarning(warnings, {
			providerId: providerId,
			domain: domain,
			connectionId: connectionId,
			message: collectionFailureMessage(failure),
			kind: kind,
			isAuth: kind === 'auth',
		});
	}

	const incomplete = metadata.completeness !== 'complete';
	if (incomplete && failures.length === 0) {
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
