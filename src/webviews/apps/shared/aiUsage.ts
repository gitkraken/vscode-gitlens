import * as l10n from '@vscode/l10n';
import type { AiUsageInfo } from '../../rpc/services/types.js';

/**
 * Compact figures for the AI usage meters ("63K", "250K", "1M"). `formatNumeric` in
 * `@gitlens/utils/date.js` has no `notation` option. Resolves against the system locale rather than the
 * configured date locale — that module keeps its resolved locales private.
 */
const compactNumberFormatter = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

/** Escalation formatters for `formatAiUsageFigure`'s collision case only — see the comment there. */
const preciseCompactNumberFormatter = new Intl.NumberFormat(undefined, {
	notation: 'compact',
	maximumFractionDigits: 3,
});
const fullNumberFormatter = new Intl.NumberFormat(undefined);

/** A credit count, compacted for display. */
export function formatAiCredits(value: number): string {
	return compactNumberFormatter.format(value);
}

/**
 * The "{used} of {limit} credits" line, at the coarsest precision that still shows the two counts as
 * different numbers.
 *
 * Compaction rounds, so counts that are merely CLOSE compact to the same string: "3.2M of 3.2M credits"
 * is what a 98.4%-spent 3,200,000 allowance renders as, and it reads as spent in full. Saying that when
 * it isn't true is the one thing this line must not do — `exhausted` is what legitimately says it.
 */
function formatAiUsageFigure(used: number, limit: number): string {
	let usedText = formatAiCredits(used);
	let limitText = formatAiCredits(limit);

	if (used !== limit && usedText === limitText) {
		usedText = preciseCompactNumberFormatter.format(used);
		limitText = preciseCompactNumberFormatter.format(limit);

		// Within a rounding step of the allowance no compact form separates them at all ("3.199999M" is
		// not a figure anyone reads), so BOTH sides fall back to full counts — a mixed
		// "3,199,999 of 3.2M" would ask the reader to compare two different units.
		if (usedText === limitText) {
			usedText = fullNumberFormatter.format(used);
			limitText = fullNumberFormatter.format(limit);
		}
	}

	return l10n.t('{used} of {limit} credits', { used: usedText, limit: limitText });
}

/** What an AI usage meter renders — see `resolveAiUsage` for the sentinel rules behind it. */
export interface ResolvedAiUsage {
	figure: string;
	/** `undefined` when there's no ratio to draw, which suppresses the bar (and the reset line). */
	percent: number | undefined;
	nearlyOut: boolean;
	/**
	 * The allowance is spent in full (or over-drawn). Mutually exclusive with `nearlyOut`, which is the
	 * approach to this state rather than a weaker form of it — a surface showing both at once would be
	 * telling the user they're almost out of something they have none of.
	 *
	 * Distinct from the zero-allowance sentinel, which never reaches this: "no weekly allowance" is
	 * having nothing to spend, not having spent it.
	 */
	exhausted: boolean;
	/**
	 * The genuinely-unlimited sentinel, kept separate from `percent == null` because the "no weekly
	 * allowance" sentinel produces that too. A surface offering to top the allowance up has to tell them
	 * apart: there's nothing to add to an unlimited allowance, while a zero one is precisely where buying
	 * credits is the only way to get any.
	 */
	unlimited: boolean;
}

/**
 * The one place the AI usage figures are resolved, so the Settings Account card and the account chip's
 * compact meter can't disagree about them.
 *
 * The two sentinels mean opposite things and must NEVER collapse into each other: -1 is genuinely
 * unlimited, while 0 is "no weekly allowance at all" (e.g. trials, org-disabled AI). Rendering 0 as
 * unlimited — or as a 0/0 bar that reads as full — tells a user with nothing that they have
 * everything. Neither sentinel has a ratio to draw, so both suppress the bar (as gk.dev does).
 *
 * A spent allowance is its own state (`exhausted`), not the top of the `nearlyOut` band: the meter used
 * to say "nearly out" at 100%, since the warning had no ceiling.
 */
export function resolveAiUsage(usage: AiUsageInfo): ResolvedAiUsage {
	const unlimited = usage.limit === -1;

	let figure: string;
	let percent: number | undefined;
	let exhausted = false;
	if (unlimited) {
		figure = l10n.t('Unlimited');
	} else if (usage.limit === 0) {
		figure = l10n.t('No weekly allowance');
	} else {
		figure = formatAiUsageFigure(usage.used, usage.limit);
		percent = Math.min(100, Math.max(0, (usage.used / usage.limit) * 100));
		// From the raw counts, not `percent`: the clamp above flattens an over-draw to exactly 100, so a
		// ratio can't tell "spent it all" from "spent more than the allowance". Resolved inside this
		// branch so the zero-allowance sentinel — where `used >= limit` is trivially true — can't reach
		// it and report an absent allowance as a spent one.
		exhausted = usage.used >= usage.limit;
	}

	return {
		figure: figure,
		percent: percent,
		// gk.dev warns as the allowance runs out. Strictly greater than 90 — exactly 90% is not a warning.
		// Whatever surfaces this must also carry it in words, so the amber fill is never the only signal
		// (docs/accessibility.md).
		nearlyOut: percent != null && percent > 90 && !exhausted,
		exhausted: exhausted,
		unlimited: unlimited,
	};
}

/** What the organization pool row renders — see `resolveAiOrgPool`. */
export interface ResolvedAiOrgPool {
	figure: string;
	/**
	 * Shares of the pool's limit, as percentages: `yours` is this user's draw, `rest` is everyone else's,
	 * and what's left of the 100 is the remaining allowance (the bar's own track, never a third segment).
	 * `undefined` when there's no ratio to draw, which suppresses the bar and its legend.
	 */
	segments: { yours: number; rest: number } | undefined;
	/**
	 * The split stated in credits, for a screen reader — the legend is a color key, so it conveys nothing
	 * on its own. `undefined` whenever `segments` is.
	 */
	summary: string | undefined;
}

/**
 * The organization's shared pool figure, plus the segments of its bar. The same two sentinels as the
 * personal figure, kept just as distinct: -1 is genuinely unlimited, 0 is no shared pool at all, and
 * neither has a ratio to state — so neither gets segments, and the figure alone says there's nothing to
 * divide up.
 *
 * `sharedUsed` is this user's own draw from the pool (a slice of `organization.used`); absent, the whole
 * used share is attributed to the rest of the organization rather than split on a guess.
 */
export function resolveAiOrgPool(
	organization: NonNullable<AiUsageInfo['organization']>,
	sharedUsed: number | undefined,
): ResolvedAiOrgPool {
	if (organization.limit === -1) {
		return { figure: l10n.t('Unlimited'), segments: undefined, summary: undefined };
	}
	if (organization.limit === 0) {
		return { figure: l10n.t('No shared allowance'), segments: undefined, summary: undefined };
	}

	// The figure states what the backend reported; only the geometry below is clamped, so a nonsense
	// payload stays visible as a number instead of being silently normalized away.
	const figure = formatAiUsageFigure(organization.used, organization.limit);
	const usedCredits = Math.max(0, organization.used);
	// Over-draw pins the bar full rather than overflowing it, exactly as the personal meter does.
	const usedPercent = Math.min(100, Math.max(0, (usedCredits / organization.limit) * 100));

	// `sharedUsed` is clamped to the pool's own total because the two are independent fields: a backend
	// reporting this user's draw ahead of the rollup would otherwise drive `rest` negative and paint a
	// negative-width segment. (GitKraken Desktop has exactly that bug — it does no clamping here.)
	const yoursCredits = sharedUsed != null ? Math.min(Math.max(0, sharedUsed), usedCredits) : 0;
	// Scaled against `used`, not `limit`, so the two segments always sum to the used share — and guarded,
	// since a pool with nothing drawn from it has no share to apportion.
	const yours = usedCredits > 0 ? usedPercent * (yoursCredits / usedCredits) : 0;
	const restCredits = usedCredits - yoursCredits;
	const remainingCredits = Math.max(0, organization.limit - usedCredits);

	return {
		figure: figure,
		segments: { yours: yours, rest: usedPercent - yours },
		summary: formatAiOrgPoolSummary(yoursCredits, restCredits, remainingCredits),
	};
}

function formatAiOrgPoolSummary(yours: number, rest: number, remaining: number): string {
	return l10n.t('Your usage {yours} credits, rest of organization {rest} credits, remaining {remaining} credits', {
		yours: formatAiCredits(yours),
		rest: formatAiCredits(rest),
		remaining: formatAiCredits(remaining),
	});
}
