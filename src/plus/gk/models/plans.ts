/* oxlint-disable no-template-curly-in-string -- marketing copy contains the literal `${aiCredits}` placeholder token */

import * as l10n from '@vscode/l10n';
import type { PaidSubscriptionPlanIds, SubscriptionPlanIds } from './subscription.js';

/**
 * Plan marketing copy — the AI credit figures and the "what you get" bullet lists shown on plan cards and
 * upgrade pitches. Authored remotely in `product.json` so pricing/packaging changes ship without an
 * extension release; {@link defaultPlansContent} is the built-in fallback for clients that can't reach (or
 * predate) the published copy.
 *
 * Every bullet string may contain the literal placeholder token `${aiCredits}` — NOT a template literal, but
 * an authored character sequence that the resolvers in `subscription.utils.ts` substitute with the plan's
 * credit figure (e.g. `'1M'`). Author these as single-quoted strings; a template literal would interpolate
 * at build time and silently produce an empty slot.
 */
export interface PlansContent {
	/** Weekly GitKraken AI credit allowance per plan — the bare figure only (e.g. `'1M'`, `'500K'`). */
	readonly aiCredits: Readonly<Record<PaidSubscriptionPlanIds, string>>;
	/**
	 * Weekly GitKraken AI credit allowance for a TRIAL, keyed by the plan being previewed. A trial's grant
	 * is its own figure, deliberately NOT the previewed plan's `aiCredits` entry — the standard 14-day
	 * trial grants `default` (`'250K'`) while previewing Pro's 1M. `default` covers every trial without a
	 * specific entry; `teams` is higher because GitKraken publishes a distinct Business Trial allowance
	 * (see https://help.gitkraken.com/general/gitkraken-ai-faq/).
	 */
	readonly trialAiCredits: { readonly default: string } & Partial<Record<PaidSubscriptionPlanIds, string>>;
	/**
	 * Plan card bullets, looked up as `features[planId] ?? features.default` — so a tier that wants its own
	 * list can simply be authored remotely, with no client change needed to start honoring it.
	 */
	readonly features: { readonly default: readonly string[] } & Partial<
		Record<SubscriptionPlanIds, readonly string[]>
	>;
	/** Upgrade-pitch bullets, keyed by the plan being PITCHED (not the plan the viewer is on). */
	readonly upgradeFeatures: Readonly<Record<'pro' | 'advanced', readonly string[]>>;
}

export const defaultPlansContent: PlansContent = {
	aiCredits: {
		student: '500K',
		pro: '1M',
		advanced: '2M',
		teams: '3M',
		enterprise: '4M',
	},
	trialAiCredits: {
		default: '250K',
		teams: '500K',
	},
	features: {
		default: [
			l10n.t('Commit Graph & Visual File History on private repos'),
			l10n.t('Issue tracker integrations — Jira, Linear & more'),
			l10n.t('Launchpad, Worktrees & Code Suggest on private repos'),
			l10n.t('AI features — {credits} credits/week', { credits: '${aiCredits}' }),
		],
		advanced: [
			l10n.t('Everything in Pro'),
			l10n.t('Self-hosted Git integrations'),
			l10n.t('Pull request automations & Team Launchpad'),
			l10n.t('Single domain SSO & AI security controls'),
			l10n.t('AI features — {credits} credits/week', { credits: '${aiCredits}' }),
		],
		teams: [
			l10n.t('Everything in Advanced'),
			l10n.t('Multi-domain SSO'),
			l10n.t('Org-level AI controls & bring-your-own-key'),
			l10n.t('GitKraken Insights & Git training'),
			l10n.t('AI features — {credits} credits/week', { credits: '${aiCredits}' }),
		],
		enterprise: [
			l10n.t('Everything in Business'),
			l10n.t('Security audit logs'),
			l10n.t('Custom terms, contracting & security review'),
			l10n.t('Dedicated CSM & SLA-backed support'),
			l10n.t('AI features — {credits} credits/week', { credits: '${aiCredits}' }),
		],
	},
	upgradeFeatures: {
		pro: [
			l10n.t('Unlimited cloud integrations'),
			l10n.t('Smart AI features — {credits} credits/week', { credits: '${aiCredits}' }),
			l10n.t('Powerful tools — Commit Graph, Visual History, & Git Worktrees for private repos'),
			l10n.t('Streamlined workflows — start work from issues, pull request reviews'),
		],
		advanced: [
			l10n.t('Self-hosted integrations'),
			l10n.t('Advanced AI features — {credits} credits/week', { credits: '${aiCredits}' }),
		],
	},
} as const;
