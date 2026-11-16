import { CancellationError } from '@gitlens/utils/cancellation.js';
import type { IntegrationIds } from '../constants.js';
import { isGitHostIntegration } from '../models/publicIntegration.js';
import { isAzureProviderId } from '../providers/providerErrors.js';
import type { ProviderResult, ProviderWarning, PullRequestForCommitResult } from '../results.js';
import { appendDedupedWarning } from '../results.js';
import { isIssuesHostIntegrationId } from '../utils/integration.utils.js';
import { appendBatchSlotWarning } from './batchEtags.js';
import type { ProviderReadContext } from './context.js';
import { runCaptured } from './drains.js';
import { trimCoordinateFields, unresolvedIntegration } from './issueBatch.js';
import { gitHostOnlySurfaceWarning, otherWarning, unsupportedWarning } from './warnings.js';

export async function getPullRequestsForCommits(
	ctx: ProviderReadContext,
	options: {
		providerId: IntegrationIds;
		/**
		 * GitHub owner, GitLab namespace path (may be nested), Bitbucket workspace, Bitbucket Data Center project key, or
		 * Azure DevOps organization.
		 */
		owner: string;
		/** Repository name or slug. */
		repo: string;
		/** Azure DevOps project. Required there, ignored elsewhere. */
		project?: string;
		/** See {@link IntegrationManager.getPullRequestsForCommits}. Repeats (ignoring case) are resolved once. */
		shas: readonly string[];
		connectionId?: string;
		/**
		 * Explicit self-managed host domain. Used only when the requested connection has no configured domain;
		 * it must come from the trusted authentication configuration, not repository or remote data.
		 */
		domain?: string;
		/** See {@link IntegrationManager.getPullRequestsForCommits}. */
		mergeQueue?: boolean;
		/** See {@link IntegrationManager.getPullRequestsForCommits}. */
		cancellation?: AbortSignal;
	},
): Promise<ProviderResult<PullRequestForCommitResult>> {
	const cancellation = options.cancellation;
	if (cancellation?.aborted) throw new CancellationError();

	const refused = (warning: ProviderWarning): ProviderResult<PullRequestForCommitResult> => ({
		items: [],
		warnings: [warning],
		fetchFailed: true,
	});
	const surface = 'Pull requests by commit';

	if (isIssuesHostIntegrationId(options.providerId)) {
		return refused(gitHostOnlySurfaceWarning(options.providerId, undefined, options.connectionId, surface));
	}

	if (options.shas.length === 0) return { items: [], warnings: [] };

	const repo = trimCoordinateFields({ owner: options.owner, repo: options.repo, project: options.project });
	const invalid = findInvalidRepository(options.providerId, repo) ?? findInvalidSha(options.shas);
	if (invalid != null) {
		return refused(otherWarning(options.providerId, undefined, options.connectionId, invalid));
	}

	const shas: string[] = [];
	const asked: string[] = [];
	const seen = new Set<string>();
	for (const sha of options.shas) {
		const trimmed = sha.trim();
		const normalized = trimmed.toLowerCase();
		if (seen.has(normalized)) continue;

		seen.add(normalized);
		shas.push(trimmed);
		asked.push(normalized);
	}

	const integration = await ctx.getIntegrationForRead(options.providerId, options.connectionId, options.domain);
	if (cancellation?.aborted) throw new CancellationError();
	if (integration == null) {
		return unresolvedIntegration(ctx, options.providerId, options.connectionId, options.domain);
	}
	if (!isGitHostIntegration(integration)) {
		return refused(gitHostOnlySurfaceWarning(options.providerId, undefined, options.connectionId, surface));
	}

	const domain = ctx.domainForRead(integration, options.providerId, options.connectionId, options.domain);
	const mergeQueue = options.mergeQueue ?? ctx.getPullRequestReadOptions().mergeQueue === true;

	const warnings: ProviderWarning[] = [];
	let fetchFailed = false;

	const { value: slots, warning } = await runCaptured(
		options.providerId,
		domain,
		options.connectionId,
		() =>
			integration.getPullRequestsForCommitsResult(
				repo,
				asked,
				{ mergeQueue: mergeQueue },
				cancellation,
				options.connectionId,
			),
		// KEEP: a missing session must warn on the primary path too, which otherwise reads it as not connected.
		{ warnOnMissingSession: true },
	);
	if (cancellation?.aborted) throw new CancellationError();

	if (warning != null) {
		appendDedupedWarning(warnings, { ...warning, targetKeys: shas });
	}

	if (slots == null) {
		if (warning == null) {
			appendDedupedWarning(warnings, {
				...unsupportedWarning(
					options.providerId,
					domain,
					options.connectionId,
					`${surface} is not supported by '${options.providerId}'.`,
				),
				targetKeys: shas,
			});
		}
		return { items: [], warnings: warnings, fetchFailed: true };
	}

	const items: PullRequestForCommitResult[] = [];
	for (let i = 0; i < shas.length; i++) {
		const slot = slots[i];
		if (slot.status === 'rejected') {
			appendBatchSlotWarning(warnings, options.providerId, domain, options.connectionId, slot, shas[i]);
			fetchFailed = true;
			continue;
		}

		items.push({ sha: shas[i], ...(slot.value != null ? { pullRequest: slot.value } : {}) });
	}

	return { items: items, warnings: warnings, fetchFailed: fetchFailed || undefined };
}

function findInvalidRepository(
	providerId: IntegrationIds,
	repo: { owner: string; repo: string; project?: string },
): string | undefined {
	if (repo.owner.length === 0 || repo.repo.length === 0) {
		return `Pull requests by commit requires a non-empty owner and repo.`;
	}
	if (isAzureProviderId(providerId) && !repo.project) {
		return `Pull requests by commit requires a project for '${providerId}'.`;
	}
	return undefined;
}

const fullShaRegex = /^[0-9a-f]{40}$/i;

function findInvalidSha(shas: readonly string[]): string | undefined {
	for (const sha of shas) {
		if (!fullShaRegex.test(sha.trim())) {
			return `Pull requests by commit got '${sha}'; pass each commit as its full 40-character SHA.`;
		}
	}
	return undefined;
}
