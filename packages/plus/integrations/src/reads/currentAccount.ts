import type { Account } from '@gitlens/git/models/author.js';
import type { IntegrationIds } from '../constants.js';
import type { ProviderWarning } from '../results.js';
import { appendDedupedWarning } from '../results.js';
import type { ProviderReadContext } from './context.js';
import { runCaptured } from './drains.js';
import { noConnectionWarning, otherWarning } from './warnings.js';

/**
 * "Who am I on this provider / connection" — {@link IntegrationBase.getCurrentAccount}'s own answer, exposed on
 * the manager so a caller can ask for it directly instead of waiting for some other read to warm it as a side
 * effect.
 */
export interface CurrentAccountResult {
	/** The signed-in account, when the provider answered. */
	account?: Account;
	warnings: ProviderWarning[];
	/**
	 * Set whenever `account` is absent. Unlike a list/batch read, this one has no benign empty answer — "who am
	 * I" is either resolved or it couldn't be told, never a legitimately empty result — so `account` is never
	 * missing without a warning explaining why.
	 */
	fetchFailed?: boolean;
}

/**
 * Resolves the viewer's own account for a git host connection. Issue trackers refuse: they only have a per-resource account.
 *
 * Goes THROUGH `Integration.getCurrentAccount`'s own cache (the hook a host supplies as
 * `IntegrationManagerCacheProvider.getCurrentAccount`) rather than adding a second one, so this read and
 * whatever else warms that cache — today, authorship enrichment on the pull request reads — stay one cache.
 */
export async function getCurrentAccount(
	ctx: ProviderReadContext,
	options: { providerId: IntegrationIds; connectionId?: string; domain?: string },
): Promise<CurrentAccountResult> {
	const integration = await ctx.getIntegrationForRead(options.providerId, options.connectionId, options.domain);
	if (integration == null) {
		const early = ctx.earlyReturnConnectionWarnings(options.providerId, options.connectionId, options.domain);
		if (early.warnings.length > 0) return { warnings: early.warnings, fetchFailed: true };

		// The untargeted primary path reads a disconnected provider as a silent empty result on the list reads; an
		// absent account must still carry a warning here, as on the batch reads — see `CurrentAccountResult.fetchFailed`.
		const domain = ctx.resolveDomainForRead(options.providerId, options.connectionId, options.domain);
		return { warnings: [noConnectionWarning(options.providerId, domain, options.connectionId)], fetchFailed: true };
	}

	const domain = ctx.domainForRead(integration, options.providerId, options.connectionId, options.domain);

	if (!integration.supportsCurrentAccount) {
		return {
			warnings: [
				otherWarning(
					options.providerId,
					domain,
					options.connectionId,
					`Current account lookup is not supported by '${options.providerId}'.`,
				),
			],
			fetchFailed: true,
		};
	}

	const { value: account, warning } = await runCaptured(
		options.providerId,
		domain,
		options.connectionId,
		async () => {
			const resolved = await integration.getCurrentAccount({ connectionId: options.connectionId });
			// `undefined` is returned bare (not `{ value: undefined }`) so `runCaptured` treats it the same as
			// a session it couldn't resolve — the only other way this read core answers nothing.
			return resolved != null ? { value: resolved } : undefined;
		},
		{ warnOnMissingSession: true },
	);

	const warnings: ProviderWarning[] = [];
	if (warning != null) {
		appendDedupedWarning(warnings, warning);
	}

	return {
		...(account != null ? { account: account } : {}),
		warnings: warnings,
		fetchFailed: account == null ? true : undefined,
	};
}
