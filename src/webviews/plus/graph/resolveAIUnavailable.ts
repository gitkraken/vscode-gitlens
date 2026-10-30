import { l10n } from 'vscode';
import { AIError, AIErrorReason, isAIUnavailableError } from '@gitlens/ai/errors.js';
import { formatPlural } from '@gitlens/utils/plural.js';
import { getPresentableErrorMessage } from '../../../errors.js';
import type { ResolveAIUnavailable } from './graphService.js';

/** The first error in a resolve run that means AI itself is unavailable, rather than one file's request failing. */
export function findAIUnavailableError(errors: readonly { error: Error }[]): Error | undefined {
	return errors.find(e => isAIUnavailableError(e.error))?.error;
}

/** Whether AI is unavailable because the weekly usage included in the user's plan ran out. */
export function isAIQuotaExceededError(ex: unknown): boolean {
	return ex instanceof AIError && ex.reason === AIErrorReason.UserQuotaExceeded;
}

/** How a resolve run's errors reach the panel: a single run-level `error` when AI was unavailable and
 *  resolved nothing, otherwise the per-file `errors` — plus one `aiUnavailable` notice, replacing the
 *  message on every file AI being unavailable left unresolved. */
export type ResolveRunErrors =
	| { error: { message: string; action?: ResolveAIUnavailable['action'] } }
	| { errors: { filePath: string; message?: string }[]; aiUnavailable?: ResolveAIUnavailable };

/**
 * Collapses a resolve run's per-file failures into one message when AI became unavailable mid-run. Once
 * AI is unavailable every remaining file fails identically (the resolve pool records them all with the
 * same error), so listing that error per file says the same thing dozens of times.
 *
 * @param resolutions The run's resolutions. Automatic both-deleted resolutions aren't AI work, so they
 * don't count as something AI resolved.
 * @param canPurchaseCredits Whether this user may buy more AI credits. Only read for a quota failure.
 */
export function classifyResolveRunErrors(
	resolutions: readonly { descriptionKind?: string }[],
	errors: readonly { filePath: string; error: Error }[],
	canPurchaseCredits: boolean,
): ResolveRunErrors {
	const unavailable = findAIUnavailableError(errors);
	if (unavailable == null) {
		return { errors: errors.map(e => ({ filePath: e.filePath, message: getPresentableErrorMessage(e.error) })) };
	}

	const notice = getAIUnavailableNotice(unavailable, canPurchaseCredits);

	if (!resolutions.some(r => r.descriptionKind !== 'automatic-both-deleted')) {
		return {
			error: {
				message: formatPlural(
					l10n.t(
						'{count, plural, one{AI is unavailable, so {count} file wasn’t resolved. {reason}} other{AI is unavailable, so {count} files weren’t resolved. {reason}}}',
					),
					{ count: errors.length, reason: notice.message },
				),
				action: notice.action,
			},
		};
	}

	return {
		// Each in-flight file fails with its own instance of the same reason, so classify every error rather
		// than matching the first one's identity.
		errors: errors.map(e =>
			isAIUnavailableError(e.error)
				? { filePath: e.filePath }
				: { filePath: e.filePath, message: getPresentableErrorMessage(e.error) },
		),
		aiUnavailable: notice,
	};
}

function getAIUnavailableNotice(error: Error, canPurchaseCredits: boolean): ResolveAIUnavailable {
	// The quota error's own text only states the reason; add what the user can do about it, as the
	// service's quota notification does.
	if (isAIQuotaExceededError(error)) {
		return canPurchaseCredits
			? {
					message: l10n.t(
						'You’ve reached the weekly AI usage included in your plan. Purchase more AI credits to keep using GitKraken AI.',
					),
					action: 'purchase-credits',
				}
			: {
					message: l10n.t(
						'You’ve reached the weekly AI usage included in your plan. Contact your organization admin or owner to request more AI credits.',
					),
				};
	}

	return { message: getPresentableErrorMessage(error) };
}
