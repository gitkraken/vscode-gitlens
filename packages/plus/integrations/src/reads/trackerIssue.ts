import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { IntegrationIds } from '../constants.js';
import { IssuesCloudHostIntegrationId } from '../constants.js';
import { isIssuesIntegration } from '../models/issuesIntegration.js';
import type { ProviderResult, ProviderWarning } from '../results.js';
import { isIssuesHostIntegrationId } from '../utils/integration.utils.js';
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

/** Issue trackers are cloud-only, so this read takes no `domain`. */
export async function getTrackerIssue(
	ctx: ProviderReadContext,
	options: {
		providerId: IntegrationIds;
		resourceId: string;
		resourceUrl?: string;
		key: string;
		connectionId?: string;
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

	const integration = await ctx.getIntegrationForRead(options.providerId, options.connectionId);
	if (integration == null) {
		const early = ctx.earlyReturnConnectionWarnings(options.providerId, options.connectionId);
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

	const domain = ctx.domainForRead(integration, options.providerId, options.connectionId);
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
