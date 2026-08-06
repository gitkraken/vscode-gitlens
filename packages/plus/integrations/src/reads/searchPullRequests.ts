import type { PullRequestSearchCriteria, PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import type { IntegrationIds } from '../constants.js';
import type { ProviderReposInput } from '../providers/models.js';
import type { ProviderPagedResult, ProviderWarning } from '../results.js';
import {
	isGitHostIntegration,
	isIssuesHostIntegrationId,
	warnOnMissingSessionForDomain,
} from '../utils/integration.utils.js';
import type { ProviderReadContext } from './context.js';
import { runCaptured } from './drains.js';
import { resolvePullRequestSearchCriteria, resolvePullRequestSearchScope } from './filters.js';
import {
	drainFlatPagesToRequestedPage,
	refusedPage,
	resolveContinuation,
	resolveCurrentPage,
	usableCursor,
} from './paging.js';
import {
	gitHostOnlySurfaceWarning,
	otherWarning,
	pullRequestSearchCapResultWarning,
	truncationWarning,
	unsupportedPullRequestSearchCriteriaWarning,
} from './warnings.js';

/**
 * Pull requests matching structured criteria over a repository/organization or current-user relationship scope.
 *
 * The read is deliberately separate from `listPullRequestsPage`: the list has provider-specific "my PRs"
 * semantics and no text channel, while this method promises a sanitized query, most-recently-updated-first
 * ordering, one upstream request per cursor-threaded page, and a quantified omission at the provider's result
 * ceiling.
 */
export async function searchPullRequestsPage(
	ctx: ProviderReadContext,
	options: {
		providerId: IntegrationIds;
		repos?: ProviderReposInput;
		org?: string;
		criteria?: PullRequestSearchCriteria;
		page?: number;
		cursor?: string;
		itemsPerPage?: number;
		forceSync?: boolean;
		connectionId?: string;
		domain?: string;
	},
): Promise<ProviderPagedResult<PullRequestShape>> {
	const page = Math.max(1, Math.trunc(options.page ?? 1));
	const refused = (warning: ProviderWarning) => refusedPage<PullRequestShape>(1, [warning], true);

	if (isIssuesHostIntegrationId(options.providerId)) {
		return refused(
			gitHostOnlySurfaceWarning(
				options.providerId,
				undefined,
				options.connectionId,
				'Filtered pull request search',
			),
		);
	}

	const integration = await ctx.getIntegrationForRead(options.providerId, options.connectionId, options.domain);
	if (integration == null) {
		const early = ctx.earlyReturnConnectionWarnings(options.providerId, options.connectionId, options.domain);
		return refusedPage(1, early.warnings, early.fetchFailed);
	}
	if (!isGitHostIntegration(integration)) {
		return refused(
			gitHostOnlySurfaceWarning(
				options.providerId,
				undefined,
				options.connectionId,
				'Filtered pull request search',
			),
		);
	}

	await ctx.forceRefreshIfRequested(integration, options.forceSync, options.connectionId);

	const domain = ctx.domainForRead(integration, options.providerId, options.connectionId, options.domain);
	const warnOnMissingSession = warnOnMissingSessionForDomain(options.providerId, options.domain);

	const resolved = resolvePullRequestSearchCriteria(options.providerId, options.criteria);
	if (resolved.rejection != null) {
		return refused(
			unsupportedPullRequestSearchCriteriaWarning(
				options.providerId,
				domain,
				options.connectionId,
				resolved.rejection,
			),
		);
	}

	const scope = resolvePullRequestSearchScope(options.providerId, options.repos, options.org, options.criteria);
	switch (scope.rejection) {
		case 'unscoped':
			return refused(
				otherWarning(
					options.providerId,
					domain,
					options.connectionId,
					'A filtered pull request search must be scoped: pass `repos`, `org`, or at least one current-user relationship.',
				),
			);
		case 'repo-ids':
			return refused(
				otherWarning(
					options.providerId,
					domain,
					options.connectionId,
					'A filtered pull request search cannot be scoped by repository id; pass repository descriptors (namespace + name) instead.',
				),
			);
		case 'unsupported-repository-scope':
		case 'unsupported-organization-scope':
			return refused(
				unsupportedPullRequestSearchCriteriaWarning(options.providerId, domain, options.connectionId, {
					reason: 'unsupported-criteria',
					criteria: [
						scope.rejection === 'unsupported-repository-scope' ? 'repositoryScope' : 'organizationScope',
					],
				}),
			);
	}

	const readPage = (cursor: string | undefined) =>
		runCaptured(
			options.providerId,
			domain,
			options.connectionId,
			() =>
				integration.searchPullRequestsPageResult(
					{
						repos: scope.repos,
						org: options.org,
						criteria: options.criteria,
						cursor: cursor,
						pageSize: options.itemsPerPage,
					},
					undefined,
					options.connectionId,
				),
			{ warnOnMissingSession: warnOnMissingSession },
		);

	const first = await readPage(options.cursor);
	const warnings = first.warning != null ? [first.warning] : [];
	let totalCount = first.value?.totalCount;
	const drained = await drainFlatPagesToRequestedPage(first, {
		requestedPage: page,
		suppliedCursor: options.cursor,
		warnings: warnings,
		readPage: readPage,
		fold: p => {
			if (p.totalCount != null) {
				totalCount = Math.max(totalCount ?? 0, p.totalCount);
			}
		},
	});
	const { value, currentPage, requestedPageMissing } = drained;

	if (value == null && warnings.length === 0) {
		return refused(
			unsupportedPullRequestSearchCriteriaWarning(options.providerId, domain, options.connectionId, {
				reason: 'unsupported-search',
			}),
		);
	}

	const items = requestedPageMissing ? [] : (value?.values ?? []);
	const continuation = resolveContinuation(
		{
			hasMore: requestedPageMissing ? false : (value?.hasMore ?? false),
			cursor: requestedPageMissing ? undefined : usableCursor(value?.cursor),
			truncated: drained.truncated,
		},
		undefined,
	);
	const truncated = continuation.truncated;
	if (truncated && warnings.length === 0) {
		warnings.push(
			pullRequestSearchCapResultWarning(options.providerId, domain, options.connectionId, totalCount) ??
				truncationWarning(options.providerId, domain, options.connectionId, 'Pull request search', 'exhausted'),
		);
	}

	return {
		items: items,
		warnings: warnings,
		page: {
			currentPage: requestedPageMissing
				? page
				: resolveCurrentPage({
						providerPage: currentPage,
						requestedPage: page,
						suppliedCursor: options.cursor,
						pageAdvanceable: false,
					}),
			itemsPerPage: items.length,
			truncated: truncated || undefined,
		},
		hasMore: continuation.hasMore,
		cursor: continuation.cursor,
		fetchFailed: drained.fetchFailed || undefined,
	};
}
