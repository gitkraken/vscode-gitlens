import type { AiUsageInfo } from '../../rpc/services/types.js';

/**
 * Unit word for the GitKraken AI allowance — credits, per the GitKraken AI help docs and pricing
 * (allowances are stated per-plan as credits/week; gk.dev's per-action breakdown tracks tokens as a
 * separate figure). Matches the Settings Account panel's plan copy from `getSubscriptionPlanAiCredits`
 * ("N credits/week"). Kept as a single constant so the unit lives in one place.
 */
export const aiUsageUnit = 'credits';

/**
 * Compact figures for the AI usage meters ("63K", "250K", "1M"). `formatNumeric` in
 * `@gitlens/utils/date.js` has no `notation` option. Resolves against the system locale rather than the
 * configured date locale — that module keeps its resolved locales private.
 */
const compactNumberFormatter = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

/** A credit count, compacted for display. */
export function formatAiCredits(value: number): string {
	return compactNumberFormatter.format(value);
}

/** What an AI usage meter renders — see `resolveAiUsage` for the sentinel rules behind it. */
export interface ResolvedAiUsage {
	figure: string;
	/** `undefined` when there's no ratio to draw, which suppresses the bar (and the reset line). */
	percent: number | undefined;
	nearlyOut: boolean;
}

/**
 * The one place the AI usage figures are resolved, so the Settings Account card and the account chip's
 * compact meter can't disagree about them.
 *
 * The two sentinels mean opposite things and must NEVER collapse into each other: -1 is genuinely
 * unlimited, while 0 is "no weekly allowance at all" (e.g. trials, org-disabled AI). Rendering 0 as
 * unlimited — or as a 0/0 bar that reads as full — tells a user with nothing that they have
 * everything. Neither sentinel has a ratio to draw, so both suppress the bar (as gk.dev does).
 */
export function resolveAiUsage(usage: AiUsageInfo): ResolvedAiUsage {
	let figure: string;
	let percent: number | undefined;
	if (usage.limit === -1) {
		figure = 'Unlimited';
	} else if (usage.limit === 0) {
		figure = 'No weekly allowance';
	} else {
		figure = `${formatAiCredits(usage.used)} of ${formatAiCredits(usage.limit)} ${aiUsageUnit}`;
		percent = Math.min(100, Math.max(0, (usage.used / usage.limit) * 100));
	}

	// gk.dev warns as the allowance runs out. Strictly greater than 90 — exactly 90% is not a warning.
	// Whatever surfaces this must also carry it in words, so the amber fill is never the only signal
	// (docs/accessibility.md).
	return { figure: figure, percent: percent, nearlyOut: percent != null && percent > 90 };
}

/**
 * The organization's shared pool figure. The same two sentinels as the personal figure, kept just as
 * distinct: -1 is genuinely unlimited, 0 is no shared pool at all, and neither has a ratio to state.
 */
export function resolveAiOrgPoolFigure(organization: NonNullable<AiUsageInfo['organization']>): string {
	if (organization.limit === -1) return 'Unlimited';
	if (organization.limit === 0) return 'No shared allowance';

	return `${formatAiCredits(organization.used)} of ${formatAiCredits(organization.limit)} ${aiUsageUnit}`;
}
