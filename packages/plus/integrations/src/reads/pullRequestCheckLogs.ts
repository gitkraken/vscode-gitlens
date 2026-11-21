import type { IntegrationIds } from '../constants.js';
import { isGitHostIntegration } from '../models/publicIntegration.js';
import { isGitHubProviderId } from '../providers/providerErrors.js';
import type {
	ProviderResult,
	ProviderWarning,
	PullRequestCheckLogResult,
	PullRequestCheckLogTarget,
} from '../results.js';
import { appendDedupedWarning } from '../results.js';
import { isIssuesHostIntegrationId } from '../utils/integration.utils.js';
import { appendBatchSlotWarning } from './batchEtags.js';
import type { ProviderReadContext } from './context.js';
import { runCaptured } from './drains.js';
import { findDuplicateKey, unresolvedIntegration } from './issueBatch.js';
import { gitHostOnlySurfaceWarning, otherWarning, unsupportedWarning } from './warnings.js';

const defaultTailLines = 200;
const maxTailLines = 2000;

export async function getPullRequestCheckLogs(
	ctx: ProviderReadContext,
	options: {
		providerId: IntegrationIds;
		connectionId?: string;
		domain?: string;
		targets: readonly PullRequestCheckLogTarget[];
		tailLines?: number;
	},
): Promise<ProviderResult<PullRequestCheckLogResult>> {
	const { providerId, connectionId } = options;
	const refused = (warning: ProviderWarning): ProviderResult<PullRequestCheckLogResult> => ({
		items: [],
		warnings: [warning],
		fetchFailed: true,
	});
	const surface = 'Reading pull request check logs';

	if (isIssuesHostIntegrationId(providerId)) {
		return refused(gitHostOnlySurfaceWarning(providerId, undefined, connectionId, surface));
	}
	if (!isGitHubProviderId(providerId)) {
		return refused(
			unsupportedWarning(
				providerId,
				undefined,
				connectionId,
				`${surface} is not supported by '${providerId}'; only GitHub and GitHub Enterprise serve check logs.`,
			),
		);
	}

	const tailLines = options.tailLines ?? defaultTailLines;
	if (!Number.isInteger(tailLines) || tailLines < 1 || tailLines > maxTailLines) {
		return refused(
			otherWarning(
				providerId,
				undefined,
				connectionId,
				`Check log tailLines ${tailLines} is invalid; expected an integer from 1 to ${maxTailLines}.`,
			),
		);
	}

	if (options.targets.length === 0) return { items: [], warnings: [] };

	const duplicateKey = findDuplicateKey(options.targets);
	if (duplicateKey != null) {
		return refused(
			otherWarning(
				providerId,
				undefined,
				connectionId,
				`Duplicate check log target key '${duplicateKey}'; keys identify results, so each must be unique.`,
			),
		);
	}

	const targets = options.targets.map(t => ({ ...t, owner: t.owner.trim(), repo: t.repo.trim() }));
	const invalid = findInvalidTarget(targets);
	if (invalid != null) return refused(otherWarning(providerId, undefined, connectionId, invalid));

	const integration = await ctx.getIntegrationForRead(providerId, connectionId, options.domain);
	if (integration == null) return unresolvedIntegration(ctx, providerId, connectionId, options.domain);
	if (!isGitHostIntegration(integration)) {
		return refused(gitHostOnlySurfaceWarning(providerId, undefined, connectionId, surface));
	}

	const domain = ctx.domainForRead(integration, providerId, connectionId, options.domain);
	const { value: slots, warning } = await runCaptured(
		providerId,
		domain,
		connectionId,
		() =>
			integration.getPullRequestCheckLogsResult(
				targets.map(t => ({ owner: t.owner, repo: t.repo, checkRunId: t.checkRunId })),
				{ tailLines: tailLines },
				undefined,
				connectionId,
			),
		{ warnOnMissingSession: true },
	);

	const warnings: ProviderWarning[] = [];
	const keys = targets.map(t => t.key);
	if (warning != null) {
		appendDedupedWarning(warnings, { ...warning, targetKeys: keys });
	}
	if (slots == null) {
		if (warning == null) {
			appendDedupedWarning(warnings, {
				...unsupportedWarning(
					providerId,
					domain,
					connectionId,
					`${surface} is not supported by '${providerId}'.`,
				),
				targetKeys: keys,
			});
		}
		return { items: [], warnings: warnings, fetchFailed: true };
	}

	const items: PullRequestCheckLogResult[] = [];
	let fetchFailed = false;
	for (let i = 0; i < targets.length; i++) {
		const slot = slots[i];
		const key = targets[i].key;
		if (slot.status === 'rejected') {
			appendBatchSlotWarning(warnings, providerId, domain, connectionId, slot, key);
			fetchFailed = true;
			continue;
		}

		items.push(
			slot.value.log != null
				? { key: key, log: slot.value.log }
				: { key: key, unavailable: slot.value.unavailable },
		);
	}

	return { items: items, warnings: warnings, fetchFailed: fetchFailed || undefined };
}

function findInvalidTarget(targets: readonly PullRequestCheckLogTarget[]): string | undefined {
	for (const target of targets) {
		if (target.owner.length === 0 || target.repo.length === 0) {
			return `Check log target '${target.key}' requires a non-empty owner and repo.`;
		}
	}
	return undefined;
}
