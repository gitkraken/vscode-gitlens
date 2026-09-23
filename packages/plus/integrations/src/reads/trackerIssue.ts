import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { IntegrationIds } from '../constants.js';
import { IssuesCloudHostIntegrationId } from '../constants.js';
import { isIssuesIntegration } from '../models/issuesIntegration.js';
import type { ProviderResult, ProviderWarning } from '../results.js';
import { areDomainsOnSameHost, hostFromDomain } from '../utils/domain.utils.js';
import { isIssuesHostIntegrationId, isIssuesSelfManagedHostIntegrationId } from '../utils/integration.utils.js';
import type { ProviderReadContext } from './context.js';
import { runCaptured } from './drains.js';
import { issueTrackerOnlySurfaceWarning, otherWarning } from './warnings.js';

export interface TrackerIssueResult {
	key: string;
	/**
	 * The resolved issue, or `undefined` when it provably does not exist or is not visible to this connection.
	 * A failed read returns no item and sets `fetchFailed`.
	 */
	issue?: IssueShape;
}

/**
 * `domain` selects the host of a self-managed tracker (Jira Data Center), as it does for
 * `listIssueTrackerIssuesPage`, and is ignored for the cloud trackers, which have a single canonical host.
 *
 * Unlike its siblings, this read never falls back to the primary connection for a self-managed tracker: it
 * requires a `domain` or a `connectionId` with a configured host and refuses otherwise. Two self-hosted
 * instances routinely issue the same project and issue keys, and this read's `issue: undefined` is a proven
 * absence a caller may cache — an answer from whichever host happens to be primary would be cached under a key
 * that names a different instance (#5872).
 */
export async function getTrackerIssue(
	ctx: ProviderReadContext,
	options: {
		providerId: IntegrationIds;
		resourceId: string;
		resourceUrl?: string;
		key: string;
		connectionId?: string;
		domain?: string;
	},
): Promise<ProviderResult<TrackerIssueResult>> {
	const refused = (warning: ProviderWarning): ProviderResult<TrackerIssueResult> => ({
		items: [],
		warnings: [warning],
		fetchFailed: true,
	});
	const surface = 'Issue resolution by key';

	if (!isIssuesHostIntegrationId(options.providerId)) {
		return refused(issueTrackerOnlySurfaceWarning(options.providerId, options.connectionId, surface));
	}

	if (options.resourceId.trim().length === 0) {
		return refused(
			otherWarning(options.providerId, undefined, options.connectionId, `${surface} requires a resource id.`),
		);
	}

	if (options.key.trim().length === 0) {
		return refused(
			otherWarning(options.providerId, undefined, options.connectionId, `${surface} requires an issue key.`),
		);
	}

	const resourceUrl = options.resourceUrl?.trim() || undefined;
	if (options.providerId === IssuesCloudHostIntegrationId.Jira && resourceUrl == null) {
		return refused(
			otherWarning(
				options.providerId,
				undefined,
				options.connectionId,
				`${surface} requires the Jira resource URL so the result contains a browser link without resource discovery.`,
			),
		);
	}

	// A `domain` only selects a host when it parses to one, and a `connectionId` only when it names a configured
	// connection that has one; anything else would resolve the primary host instead, which is the fallback this
	// read refuses.
	if (
		isIssuesSelfManagedHostIntegrationId(options.providerId) &&
		(options.domain != null
			? hostFromDomain(options.domain) == null
			: options.connectionId == null ||
				!ctx
					.getConfigured(options.providerId)
					.some(c => c.id === options.connectionId && hostFromDomain(c.domain) != null))
	) {
		return refused(
			otherWarning(
				options.providerId,
				undefined,
				options.connectionId,
				`${surface} requires a domain or a configured connection id for '${options.providerId}': every configured host can hold a different issue under the same key, so the read does not answer from the primary connection.`,
			),
		);
	}

	const integration = await ctx.getIntegrationForRead(options.providerId, options.connectionId, options.domain);
	if (integration == null) {
		// A supplied connectionId or domain that no longer resolves is a broken target, not an empty account.
		const early = ctx.earlyReturnConnectionWarnings(options.providerId, options.connectionId, options.domain);
		return { items: [], warnings: early.warnings, fetchFailed: early.fetchFailed || undefined };
	}
	if (!isIssuesIntegration(integration)) {
		return refused(issueTrackerOnlySurfaceWarning(options.providerId, options.connectionId, surface));
	}
	if (!integration.supportsIssueLookupByResourceId) {
		return refused(
			otherWarning(
				options.providerId,
				undefined,
				options.connectionId,
				`${surface} is not supported by '${options.providerId}'; its single-issue read cannot prove an absence, so a miss would not be safe to cache.`,
			),
		);
	}

	// A self-managed tracker's single resource is its host, and the read is keyed (and cached) by `resourceId`
	// while it is addressed to the host `domain`/`connectionId` resolved. When they disagree, host B's answer —
	// including a cacheable absence — would be stored under host A's key.
	if (
		isIssuesSelfManagedHostIntegrationId(options.providerId) &&
		!areDomainsOnSameHost(options.resourceId, integration.domain)
	) {
		return refused(
			otherWarning(
				options.providerId,
				undefined,
				options.connectionId,
				`${surface} requires the resource id of '${options.providerId}' to name the host the read resolved to.`,
			),
		);
	}

	const domain = ctx.domainForRead(integration, options.providerId, options.connectionId, options.domain);
	const issue = await runCaptured(
		options.providerId,
		domain,
		options.connectionId,
		() =>
			integration.getIssueByResourceIdResult(options.resourceId, options.key, {
				connectionId: options.connectionId,
				resourceUrl: resourceUrl,
			}),
		{ warnOnMissingSession: true },
	);
	if (issue.warning != null) {
		return refused(issue.warning);
	}

	return {
		items: [{ key: options.key, ...(issue.value != null ? { issue: issue.value } : {}) }],
		warnings: [],
	};
}
