import type { PullRequestActivityItem } from '@gitlens/git/models/pullRequestActivity.js';
import type { IntegrationIds } from '../constants.js';
import { githubGraphQLInt32Max, isGitHubProviderId } from '../providers/providerErrors.js';
import type { ProviderResult, ProviderWarning } from '../results.js';
import { appendDedupedWarning } from '../results.js';
import { isGitHostIntegration, isIssuesHostIntegrationId } from '../utils/integration.utils.js';
import { appendBatchSlotWarning } from './batchEtags.js';
import type { ProviderReadContext } from './context.js';
import { runCaptured } from './drains.js';
import { findDuplicateKey, unresolvedIntegration } from './issueBatch.js';
import { gitHostOnlySurfaceWarning, otherWarning, unsupportedWarning } from './warnings.js';

/** One pull request whose activity to read, echoed back under the caller's own `key`. */
export interface PullRequestActivityTarget {
	/** Caller-owned identifier, echoed on the result. Must be unique. */
	key: string;
	owner: string;
	repo: string;
	number: number;
	/** The {@link PullRequestActivityResult.cursor} of this pull request's last read. Omit it, or send `''`, for a first read. */
	cursor?: string;
}

/** The answer for one {@link PullRequestActivityTarget}. */
export interface PullRequestActivityResult {
	key: string;
	/** New activity after the target's cursor, in GitHub's timeline order. A review's inline comments follow the review. */
	items: readonly PullRequestActivityItem[];
	/** Opaque: send it back as the target's `cursor` on the next read. */
	cursor: string;
	/** More items follow this page; read again with `cursor`. */
	hasMore: boolean;
	/** The pull request (or its repository) does not exist or is not visible to this connection. */
	notFound?: true;
}

const defaultLimit = 30;
const maxLimit = 100;

export async function getPullRequestActivity(
	ctx: ProviderReadContext,
	options: {
		providerId: IntegrationIds;
		connectionId?: string;
		domain?: string;
		targets: readonly PullRequestActivityTarget[];
		limit?: number;
	},
): Promise<ProviderResult<PullRequestActivityResult>> {
	const { providerId, connectionId } = options;
	const refused = (warning: ProviderWarning): ProviderResult<PullRequestActivityResult> => ({
		items: [],
		warnings: [warning],
		fetchFailed: true,
	});
	const surface = 'Reading pull request activity';

	if (isIssuesHostIntegrationId(providerId)) {
		return refused(gitHostOnlySurfaceWarning(providerId, undefined, connectionId, surface));
	}
	if (!isGitHubProviderId(providerId)) {
		return refused(
			unsupportedWarning(
				providerId,
				undefined,
				connectionId,
				`${surface} is not supported by '${providerId}'; only GitHub and GitHub Enterprise serve pull request activity.`,
			),
		);
	}

	const limit = options.limit ?? defaultLimit;
	if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
		return refused(
			otherWarning(
				providerId,
				undefined,
				connectionId,
				`Pull request activity limit ${limit} is invalid; expected an integer from 1 to ${maxLimit}.`,
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
				`Duplicate pull request activity target key '${duplicateKey}'; keys identify results, so each must be unique.`,
			),
		);
	}

	const targets = options.targets.map(t => ({
		...t,
		owner: t.owner.trim(),
		repo: t.repo.trim(),
		cursor: t.cursor || undefined,
	}));
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
			integration.getPullRequestActivityResult(
				targets.map(t => ({ owner: t.owner, repo: t.repo, number: t.number, cursor: t.cursor })),
				{ limit: limit },
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

	const items: PullRequestActivityResult[] = [];
	let fetchFailed = false;
	for (let i = 0; i < targets.length; i++) {
		const slot = slots[i];
		const target = targets[i];
		if (slot.status === 'rejected') {
			appendBatchSlotWarning(warnings, providerId, domain, connectionId, slot, target.key);
			fetchFailed = true;
			continue;
		}

		items.push(
			slot.value != null
				? { key: target.key, items: slot.value.items, cursor: slot.value.cursor, hasMore: slot.value.hasMore }
				: { key: target.key, items: [], cursor: target.cursor ?? '', hasMore: false, notFound: true },
		);
	}

	return { items: items, warnings: warnings, fetchFailed: fetchFailed || undefined };
}

function findInvalidTarget(targets: readonly PullRequestActivityTarget[]): string | undefined {
	for (const target of targets) {
		if (!Number.isSafeInteger(target.number) || target.number <= 0) {
			return `Pull request activity target '${target.key}' has number ${target.number}; expected a positive integer.`;
		}
		if (target.number > githubGraphQLInt32Max) {
			return `Pull request activity target '${target.key}' has number ${target.number}; GitHub numbers are 32-bit and cannot exceed ${githubGraphQLInt32Max}.`;
		}
		if (target.owner.length === 0 || target.repo.length === 0) {
			return `Pull request activity target '${target.key}' requires a non-empty owner and repo.`;
		}
	}
	return undefined;
}
