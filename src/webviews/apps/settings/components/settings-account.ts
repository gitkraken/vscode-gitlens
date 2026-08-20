import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { getDateDifference } from '@gitlens/utils/date.js';
import { pluralize } from '@gitlens/utils/string.js';
import { urls } from '../../../../constants.js';
import { proTrialLengthInDays, SubscriptionState } from '../../../../constants.subscription.js';
import type { Source } from '../../../../constants.telemetry.js';
import type { PromoPlans } from '../../../../plus/gk/models/promo.js';
import type {
	Subscription,
	SubscriptionPlanIds,
	SubscriptionUpgradeCommandArgs,
} from '../../../../plus/gk/models/subscription.js';
import {
	compareSubscriptionPlans,
	getSubscriptionEntitlement,
	getSubscriptionNextPaidPlanId,
	getSubscriptionPlanAiCredits,
	getSubscriptionPlanName,
	isSubscriptionPaid,
	isSubscriptionPaidPlan,
} from '../../../../plus/gk/utils/subscription.utils.js';
import { createCommandLink } from '../../../../system/commands.js';
import type { AiUsageInfo } from '../../../rpc/services/types.js';
import { accountRingStyles } from '../../plus/shared/components/accountRing.css.js';
import { cspStyleMap } from '../../shared/components/csp-style-map.directive.js';
import type { GlPromo } from '../../shared/components/promo.js';
import { boxSizingBase, linkBase } from '../../shared/components/styles/lit/base.css.js';
import type { PromosContext } from '../../shared/contexts/promos.js';
import { promosContext } from '../../shared/contexts/promos.js';
import type { SubscriptionContextState } from '../../shared/contexts/subscription.js';
import { subscriptionContext } from '../../shared/contexts/subscription.js';
import { formatDate } from '../../shared/date.js';
import type { SettingsState } from '../state.js';
import { settingsStateContext } from '../state.js';
import '../../shared/components/badges/badge.js';
import '../../shared/components/button.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/promo.js';
import '../../shared/components/skeleton-loader.js';

declare global {
	interface HTMLElementTagNameMap {
		['gl-settings-account']: GlSettingsAccount;
	}
}

/**
 * Unit word for the GitKraken AI allowance — credits, per the GitKraken AI help docs and pricing
 * (allowances are stated per-plan as credits/week; gk.dev's per-action breakdown tracks tokens as a
 * separate figure). Matches this panel's plan copy from `getPlanAiCredits` ("N credits/week"). Kept as
 * a single constant so the unit lives in one place.
 */
const aiUsageUnit = 'credits';

/**
 * Compact figures for the AI usage card ("63K", "250K", "1M"). `formatNumeric` in
 * `@gitlens/utils/date.js` has no `notation` option, and a single consumer doesn't warrant a new shared
 * utility. Resolves against the system locale rather than the configured date locale — that module keeps
 * its resolved locales private.
 */
const compactNumberFormatter = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

/** Absolute-date format used across the panel — the same one the commit surfaces use. */
const planDateFormat = 'MMMM Do, YYYY';

/**
 * What the given plan includes. Each paid tier above Pro stacks on the one below it with an
 * "Everything in X" lead, mirroring how GitKraken's own pricing presents them, so the list stays short
 * enough to scan instead of restating four tiers' worth of bullets.
 */
function getPlanFeatures(planId: SubscriptionPlanIds, trial: boolean): string[] {
	// This branch is the Pro pitch, shown to Community/unpaid users as well as to Pro and Student — so a
	// Community id must resolve to Pro's figure deliberately (via the paid-plan guard), not by falling
	// through `getSubscriptionPlanAiCredits`'s exhaustive switch, which can't accept an unpaid id at all.
	const creditsPlanId = isSubscriptionPaidPlan(planId) ? planId : 'pro';
	const credits = `AI features — ${getSubscriptionPlanAiCredits(creditsPlanId, trial)} credits/week`;

	switch (planId) {
		case 'advanced':
			return [
				'Everything in Pro',
				'Self-hosted Git integrations',
				'Pull request automations & Team Launchpad',
				'Single domain SSO & AI security controls',
				credits,
			];
		case 'teams':
			return [
				'Everything in Advanced',
				'Multi-domain SSO',
				'Org-level AI controls & bring-your-own-key',
				'GitKraken Insights & Git training',
				credits,
			];
		case 'enterprise':
			return [
				'Everything in Business',
				'Security audit logs',
				'Custom terms, contracting & security review',
				'Dedicated CSM & SLA-backed support',
				credits,
			];
		default:
			return [
				'Commit Graph & Visual File History on private repos',
				'Issue tracker integrations — Jira, Linear & more',
				'Launchpad, Worktrees & Code Suggest on private repos',
				credits,
			];
	}
}

/**
 * One resolved plan-card state — the six subscription states collapsed into what the card actually
 * renders, so the state switch reads as a table instead of six near-identical templates.
 */
interface PlanCardContent {
	title: string;
	/** Accent TIER badge (Advanced / Business / Student / …) — omitted when the tier is just "Pro". */
	tier?: string;
	/** Neutral STATUS badge (Trial / Unverified). */
	status?: string;
	meta: string;
	cta?: { label: string; href: string; promo?: PromoPlans };
	/** The "Already have a GitKraken account?" line — only when there's no account to sign in to. */
	showSignInLine?: boolean;
	featuresHeading: string;
	/** Pro isn't active, so the bullets are an offer rather than an inventory (lock icons, not checks). */
	locked: boolean;
	/** 0–100 REMAINING share of the trial window; only set while trialling. */
	trialRemaining?: number;
}

/**
 * The Account section's panel — a card stack over the standard category header: an optional
 * verification alert, the signed-in identity, the plan (badges, meta, CTA, trial progress, feature
 * list, Advanced upsell), GitKraken AI usage, the active organization, refer-a-friend, and a footer
 * link row.
 *
 * Account/plan state comes from the shared subscription RPC signals (via `subscriptionContext`, the same
 * bridge the Graph header and Home view use); AI usage comes from the settings state. Everything acts
 * through command links — nothing here writes config.
 *
 * The compact `gl-account-chip` still owns the Graph header and Home view; this panel deliberately
 * reuses its behavior (command ids, entitlement ring, promo wiring) without reusing its layout.
 */
@customElement('gl-settings-account')
export class GlSettingsAccount extends SignalWatcher(LitElement) {
	static override styles = [
		boxSizingBase,
		linkBase,
		accountRingStyles,
		css`
			:host {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-16);

				/* So the feature grid's column query measures the pane, not the viewport */
				container-type: inline-size;
			}

			/* ── Shared chrome ── */

			/* Outlined, matching settings-setup's .step — the card treatment the rest of this webview uses. */
			.card {
				background: transparent;
				border: var(--gl-border-width) solid var(--vscode-widget-border, var(--color-foreground--25));
				border-radius: var(--gl-radius-md);
			}

			/* Quiet action — transparent with the widget hairline, matching settings-setup's quiet step
			   action. gl-button has no such appearance, so it's dialed in through the component's own
			   custom properties rather than by adding a shared variant for one surface. */
			.button--quiet {
				--button-foreground: var(--color-foreground--75);
				--button-background: transparent;
				--button-hover-background: var(--vscode-toolbar-hoverBackground);
				--button-border: var(--vscode-widget-border, var(--color-foreground--25));
			}

			/* Squared off from gl-badge's pill default and tinted — at this size the elliptical outline read
			   as a control sitting beside the plan name rather than a label on it. Overridden locally rather
			   than on the shared default, which other surfaces still want as a pill. The bottom padding buys
			   back the room the all-caps text's missing descenders would otherwise leave under it. */
			gl-badge {
				--gl-badge-color: var(--color-foreground--75);

				display: inline-flex;
				align-items: center;
			}

			gl-badge::part(base) {
				align-items: center;
				padding: 0 var(--gl-space-6) var(--gl-space-2);
				background-color: color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
				border: none;
				border-radius: var(--gl-radius-sm);
			}

			gl-promo:not([has-promo]) {
				display: none;
			}

			gl-promo::part(text) {
				margin-block-start: 0;
				font-size: var(--gl-font-sm);
			}

			/* ── Verification alert ── */

			/* Filled, unlike the cards — it's an alert. Same recipe as the other alerts in this webview. */
			.alert {
				display: flex;
				gap: var(--gl-space-10);
				align-items: flex-start;
				padding: var(--gl-space-12) 1.4rem;
				color: var(--color-foreground--85);
				background-color: color-mix(in srgb, var(--color-alert-warningBackground) 60%, transparent);
				border: var(--gl-border-width) solid
					color-mix(in srgb, var(--color-alert-warningBorder) 70%, transparent);
				border-radius: var(--gl-radius-md);
			}

			.alert__icon {
				flex: none;
				margin-block-start: 0.1rem;
				font-size: 1.4rem;
				color: var(--vscode-charts-yellow);
			}

			.alert__body {
				flex: 1;
				min-width: 0;
			}

			.alert__text {
				margin: 0;
				font-size: var(--gl-font-md);
			}

			.alert__actions {
				display: flex;
				flex-wrap: wrap;
				gap: var(--gl-space-8);
				align-items: center;
				margin-block-start: var(--gl-space-10);
			}

			/* ── Identity ── */

			.identity__main {
				display: flex;
				flex-wrap: wrap;
				gap: var(--gl-space-12);
				align-items: center;
				padding: 1.4rem var(--gl-space-16);
			}

			.identity__media {
				display: grid;
				flex: none;
				place-items: center;
				width: 4rem;
				height: 4rem;
			}

			/* Ring matches the Graph header's account pill (accountRing.css.ts) so the same entitlement reads
			   the same everywhere. Only the photo gets it — the no-avatar fallback is a square-ish glyph, and
			   a circular ring around it would read as a mistake. */
			.identity__media img {
				width: 4rem;
				aspect-ratio: 1 / 1;
				background-color: color-mix(in srgb, var(--color-foreground) 10%, transparent);
				border-radius: 50%;
				box-shadow: 0 0 0 var(--gl-account-ring-width) var(--gl-account-ring-color);
			}

			.identity__media code-icon {
				font-size: 2rem;
				color: var(--color-foreground--65);
			}

			.identity__text {
				flex: 1;
				min-width: 14rem;
			}

			.identity__name {
				margin: 0;
				font-size: 1.5rem;
				font-weight: 600;
				color: var(--color-foreground);
			}

			.identity__email {
				margin: var(--gl-space-2) 0 0;
				overflow: hidden;
				text-overflow: ellipsis;
				font-size: var(--gl-font-md);
				font-weight: 400;
				color: var(--color-foreground--65);
				white-space: nowrap;
			}

			.identity__actions {
				display: flex;
				flex: none;
				flex-wrap: wrap;
				gap: var(--gl-space-8);
				align-items: center;
			}

			.identity__footer {
				display: flex;
				flex-wrap: wrap;
				gap: var(--gl-space-8);
				align-items: center;
				padding: 0.9rem var(--gl-space-16);
				font-size: var(--gl-font-sm);
				color: var(--color-foreground--50);
				border-block-start: var(--gl-border-width) solid
					var(--vscode-widget-border, var(--color-foreground--25));
			}

			.identity__device {
				flex: 1;
				min-width: 0;
			}

			.identity__sync {
				display: inline-flex;
				flex: none;
				gap: 0.5rem;
				align-items: center;
			}

			/* Underline the label, not the icon — it has to come off the anchor, since the icon can't opt
			   out of an inherited decoration from its own side. */
			.identity__sync:hover {
				text-decoration: none;
			}

			.identity__sync:hover .identity__sync-label {
				text-decoration: underline;
			}

			/* ── Plan ── */

			.plan__head {
				display: flex;
				flex-wrap: wrap;
				gap: var(--gl-space-12);
				align-items: flex-start;
				padding: 1.4rem var(--gl-space-16);
			}

			.plan__headline {
				flex: 1;
				min-width: 18rem;
			}

			.plan__title-row {
				display: flex;
				flex-wrap: wrap;
				gap: var(--gl-space-6);
				align-items: center;
			}

			.plan__title {
				margin: 0;
				font-size: var(--gl-font-lg);
				font-weight: 600;
				color: var(--color-foreground);
			}

			/* Accents the TIER badge (what was bought); STATUS badges (Trial / Unverified) keep the neutral
			   default. Sharing one treatment would make an upgrade and a countdown read as the same kind of
			   claim — the same distinction account-chip's renderPlanTitle draws, kept in sync here. */
			.plan__tier {
				--gl-badge-color: var(--vscode-textLink-foreground);
			}

			.plan__tier::part(base) {
				background-color: color-mix(in srgb, var(--vscode-textLink-foreground) 14%, transparent);
			}

			.plan__meta {
				margin: var(--gl-space-6) 0 0;
				font-size: var(--gl-font-md);
				line-height: 1.5;
				color: var(--color-foreground--75);
				text-wrap: pretty;
			}

			.plan__cta {
				display: flex;
				flex: none;
				flex-direction: column;
				gap: var(--gl-space-4);
				align-items: flex-end;
			}

			.plan__progress {
				padding: 0 var(--gl-space-16) 1.4rem;
			}

			.plan__track {
				height: 0.4rem;
				overflow: hidden;
				background: color-mix(in srgb, var(--color-foreground) 12%, transparent);
				border-radius: var(--gl-radius-circle);
			}

			.plan__fill {
				height: 100%;
				background: var(--vscode-charts-yellow);
				border-radius: var(--gl-radius-circle);
			}

			.plan__secondary {
				padding: 0 var(--gl-space-16) 1.4rem;
				margin: 0;
				font-size: var(--gl-font-md);
				color: var(--color-foreground--65);
			}

			.plan__features {
				padding: var(--gl-space-12) var(--gl-space-16) 1.4rem;
				border-block-start: var(--gl-border-width) solid
					var(--vscode-widget-border, var(--color-foreground--25));
			}

			/* Matches settings-detail's .preview__label — the same uppercase eyebrow, in the same pane */
			.plan__features-title {
				margin: 0 0 var(--gl-space-10);
				font-size: 1.05rem;
				font-weight: 400;
				color: var(--color-foreground--50);
				text-transform: uppercase;
				letter-spacing: 0.06em;
			}

			.plan__feature-list {
				display: grid;
				grid-template-columns: 1fr 1fr;
				gap: var(--gl-space-8) var(--gl-space-16);
				padding: 0;
				margin: 0;
				list-style: none;
			}

			.plan__feature {
				display: flex;
				gap: var(--gl-space-8);
				align-items: flex-start;
				font-size: var(--gl-font-md);
				color: var(--color-foreground--75);
			}

			.plan__feature code-icon {
				flex: none;
				margin-block-start: 0.1rem;
				font-size: 1.3rem;
				color: var(--gl-stat-added);
			}

			.plan__features--locked .plan__feature code-icon {
				color: var(--color-foreground--50);
			}

			.plan__feature span {
				flex: 1;
				text-wrap: pretty;
			}

			.plan__upsell {
				display: flex;
				flex-wrap: wrap;
				gap: var(--gl-space-12);
				align-items: center;
				padding: 1.1rem var(--gl-space-16);
				background: color-mix(in srgb, var(--vscode-textLink-foreground) 6%, transparent);
				border-block-start: var(--gl-border-width) solid
					var(--vscode-widget-border, var(--color-foreground--25));
				border-radius: 0 0 var(--gl-radius-md) var(--gl-radius-md);
			}

			.plan__upsell-text {
				flex: 1;
				min-width: 0;
				font-size: var(--gl-font-md);
				color: var(--color-foreground--75);
				text-wrap: pretty;
			}

			/* ── GitKraken AI usage ── */

			.ai {
				padding: 1.4rem var(--gl-space-16);
			}

			.ai__head {
				display: flex;
				gap: var(--gl-space-10);
				align-items: baseline;
			}

			.ai__icon {
				flex: none;
				color: var(--color-foreground--65);
			}

			.ai__title {
				flex: 1;
				margin: 0;
				font-size: var(--gl-font-base);
				font-weight: 600;
				color: var(--color-foreground);
			}

			/* Text carrier for the state the bar's color also shows, so "nearly out" never lives in color
			   alone (docs/accessibility.md). Foreground-register warning token so a hairline of text still
			   out-contrasts the card behind it. */
			.ai__warning {
				flex: none;
				font-size: var(--gl-font-sm);
				color: var(--vscode-editorWarning-foreground, var(--vscode-charts-yellow));
			}

			.ai__figure {
				flex: none;
				font-family: var(--vscode-editor-font-family);
				font-size: var(--gl-font-md);
				color: var(--color-foreground--75);
			}

			.ai__track {
				height: 0.6rem;
				margin-block-start: var(--gl-space-10);
				overflow: hidden;
				background: color-mix(in srgb, var(--color-foreground) 12%, transparent);
				border-radius: var(--gl-radius-circle);
			}

			.ai__fill {
				height: 100%;
				background: var(--vscode-progressBar-background);
				border-radius: var(--gl-radius-circle);
			}

			.ai__fill--warning {
				background: var(--vscode-charts-yellow);
			}

			/* Supplementary to the personal figure, so it stays in the subdued register of the reset line
			   below rather than competing with the meter above — a second bar for the pool would read as a
			   second allowance this user can spend. */
			.ai__org {
				margin: var(--gl-space-8) 0 0;
				font-size: var(--gl-font-sm);
				color: var(--color-foreground--65);
			}

			.ai__reset {
				margin: var(--gl-space-8) 0 0;
				font-size: var(--gl-font-sm);
				color: var(--color-foreground--50);
			}

			/* ── Organization ── */

			.org {
				display: flex;
				gap: var(--gl-space-12);
				align-items: center;
				padding: var(--gl-space-12) var(--gl-space-16);
			}

			.org__icon {
				flex: none;
				font-size: 1.8rem;
				color: var(--color-foreground--65);
			}

			.org__text {
				flex: 1;
				min-width: 0;
			}

			.org__name {
				margin: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				font-size: var(--gl-font-base);
				font-weight: 600;
				color: var(--color-foreground);
				white-space: nowrap;
			}

			.org__meta {
				margin: var(--gl-space-2) 0 0;
				font-size: var(--gl-font-sm);
				color: var(--color-foreground--65);
			}

			/* ── Refer a friend ── */

			.refer {
				display: flex;
				flex-wrap: wrap;
				gap: var(--gl-space-10);
				align-items: center;
				padding: 1.1rem var(--gl-space-16);
				border: var(--gl-border-width) dashed var(--vscode-widget-border, var(--color-foreground--25));
				border-radius: var(--gl-radius-md);
			}

			.refer__icon {
				flex: none;
				font-size: 1.5rem;
				color: var(--color-foreground--65);
			}

			.refer__text {
				flex: 1;
				min-width: 0;
				font-size: var(--gl-font-md);
				color: var(--color-foreground--75);
			}

			.refer a {
				flex: none;
				font-size: var(--gl-font-md);
			}

			/* ── Footer ── */

			.footer {
				display: flex;
				flex-wrap: wrap;
				gap: var(--gl-space-16);
				align-items: center;
				padding-block-start: 1.4rem;
				font-size: var(--gl-font-md);
				border-block-start: var(--gl-border-width) solid
					var(--vscode-widget-border, var(--color-foreground--25));
			}

			.footer__note {
				margin-inline-start: auto;
				font-size: var(--gl-font-sm);
				color: var(--color-foreground--50);
			}

			@container (max-width: 520px) {
				.plan__feature-list {
					grid-template-columns: 1fr;
				}
			}

			/* Forced-colors mode drops box-shadow; repaint the entitlement ring as an outline, which survives
			   and is equally layout-free. */
			@media (forced-colors: active) {
				.identity__media img {
					outline: 0.1rem solid ButtonBorder;
					outline-offset: 0.1rem;
				}
			}
		`,
	];

	@consume({ context: subscriptionContext, subscribe: true })
	private _subscription!: SubscriptionContextState;

	@consume({ context: settingsStateContext })
	private _state!: SettingsState;

	@consume({ context: promosContext })
	private _promos!: PromosContext;

	private get subscription(): Subscription | undefined {
		return this._subscription.subscription.get();
	}

	private get subscriptionState(): SubscriptionState | undefined {
		return this.subscription?.state;
	}

	/** Drives the avatar's entitlement ring — matches the Graph header's account pill. */
	private get entitlement(): 'unpaid' | 'trial' | 'paid' | undefined {
		return getSubscriptionEntitlement(this.subscriptionState);
	}

	private get planId(): SubscriptionPlanIds {
		return this.subscription?.plan.actual.id ?? 'pro';
	}

	private get effectivePlanId(): SubscriptionPlanIds {
		return this.subscription?.plan.effective.id ?? 'pro';
	}

	override render(): unknown {
		const sub = this.subscription;
		// `subscription` starts undefined — even Community users get a Subscription object once it loads —
		// so anything rendered before then would assert an account state that isn't known yet.
		if (sub === undefined) {
			return html`<skeleton-loader
				lines="10"
				role="status"
				aria-label="Loading account status"
			></skeleton-loader>`;
		}

		return html`${this.renderVerificationAlert()} ${this.renderIdentityCard(sub)} ${this.renderPlanCard(sub)}
		${this.renderAiUsageCard(sub)} ${this.renderOrganizationCard(sub)} ${this.renderReferFriendCard(sub)}
		${this.renderFooter(sub)}`;
	}

	// ── Cards ──

	private renderVerificationAlert() {
		if (this.subscriptionState !== SubscriptionState.VerificationRequired) return nothing;

		return html`<div class="alert" role="alert">
			<code-icon class="alert__icon" icon="warning" aria-hidden="true"></code-icon>
			<div class="alert__body">
				<p class="alert__text">Verify your email before you can access Pro features.</p>
				<div class="alert__actions">
					<gl-button
						href=${createCommandLink<Source>('gitlens.plus.resendVerification', {
							source: 'account',
							detail: { location: 'settings-account:verification' },
						})}
						>Resend Email</gl-button
					>
					<gl-button
						appearance="secondary"
						href=${createCommandLink<Source>('gitlens.plus.validate', {
							source: 'account',
							detail: { location: 'settings-account:verification' },
						})}
						><code-icon icon="refresh" slot="prefix" aria-hidden="true"></code-icon> Check again</gl-button
					>
				</div>
			</div>
		</div>`;
	}

	/**
	 * The footer strip deliberately carries no "status synced …" timestamp: `SubscriptionService` strips
	 * `lastValidatedAt` off the `Subscription` it hands out (it survives only in a private field,
	 * re-attached when writing to storage), so the field is always `undefined` by the time it reaches a
	 * webview. Surfacing it would need a host getter, a new RPC signal, and a new field on the SHARED
	 * `subscriptionContext` that Graph, Home, and the account chip all consume — too much reach for one
	 * line of secondary copy. Don't re-add it against `sub.lastValidatedAt`; it will silently render nothing.
	 */
	private renderIdentityCard(sub: Subscription) {
		const account = sub.account;
		if (account == null) return nothing;

		const avatar = this._subscription.avatar.get();

		return html`<div class="card">
			<div class="identity__main">
				<span class="identity__media" data-entitlement=${this.entitlement ?? 'loading'}>
					${
						avatar
							? html`<img src=${avatar} alt="" />`
							: html`<code-icon icon="gl-gitlens" aria-hidden="true"></code-icon>`
					}
				</span>
				<div class="identity__text">
					<h3 class="identity__name">${account.name}</h3>
					${account.email ? html`<p class="identity__email">${account.email}</p>` : nothing}
				</div>
				<div class="identity__actions">
					<gl-button
						appearance="secondary"
						href=${createCommandLink<Source>('gitlens.plus.manage', {
							source: 'account',
							detail: { location: 'settings-account:identity' },
						})}
						>Manage Account
						<code-icon icon="link-external" slot="suffix" aria-hidden="true"></code-icon>
					</gl-button>
					<gl-button
						class="button--quiet"
						appearance="secondary"
						href=${createCommandLink<Source>('gitlens.plus.logout', {
							source: 'account',
							detail: { location: 'settings-account:identity' },
						})}
						><code-icon icon="sign-out" slot="prefix" aria-hidden="true"></code-icon> Sign Out</gl-button
					>
				</div>
			</div>
			<div class="identity__footer">
				<code-icon icon="device-desktop" aria-hidden="true"></code-icon>
				<span class="identity__device">Signed in on this device</span>
				<a
					class="identity__sync"
					href=${createCommandLink<Source>('gitlens.plus.validate', {
						source: 'account',
						detail: { location: 'settings-account:identity' },
					})}
					><code-icon icon="sync" aria-hidden="true"></code-icon
					><span class="identity__sync-label">Sync Status</span></a
				>
			</div>
		</div>`;
	}

	private renderPlanCard(sub: Subscription) {
		const content = this.getPlanCardContent(sub);
		const trial = sub.state === SubscriptionState.Trial;
		const features = getPlanFeatures(trial ? this.effectivePlanId : this.planId, trial);

		return html`<div class="card">
			<div class="plan__head">
				<div class="plan__headline">
					<div class="plan__title-row">
						<h3 class="plan__title">${content.title}</h3>
						${content.tier ? html`<gl-badge class="plan__tier">${content.tier}</gl-badge>` : nothing}
						${content.status ? html`<gl-badge>${content.status}</gl-badge>` : nothing}
					</div>
					<p class="plan__meta">${content.meta}</p>
				</div>
				${
					content.cta != null
						? html`<div class="plan__cta">
								<gl-button href=${content.cta.href}>${content.cta.label}</gl-button>
								${content.cta.promo != null ? this.renderPromo(content.cta.promo) : nothing}
							</div>`
						: nothing
				}
			</div>
			${
				// REMAINING, not elapsed — this bar has to agree with the sentence directly above it. The meta
				// reads "9 of 14 days left", so the bar draws that same fraction and depletes toward the
				// deadline. Filling it with elapsed time instead would put a mostly-empty bar under "9 of 14
				// days left", where the picture and the number contradict each other. It deliberately runs the
				// opposite direction to the AI usage bar below: this is a resource draining, that one is a
				// meter filling.
				content.trialRemaining != null
					? html`<div class="plan__progress">
							<div class="plan__track" aria-hidden="true">
								<div
									class="plan__fill"
									style=${cspStyleMap({ inlineSize: `${content.trialRemaining}%` })}
								></div>
							</div>
						</div>`
					: nothing
			}
			${
				content.showSignInLine
					? html`<p class="plan__secondary">
							Already have a GitKraken account?
							<a
								href=${createCommandLink<Source>('gitlens.plus.login', {
									source: 'account',
									detail: { location: 'settings-account:plan-card' },
								})}
								>sign in</a
							>
						</p>`
					: nothing
			}
			<div class="plan__features ${content.locked ? 'plan__features--locked' : ''}">
				<h4 class="plan__features-title" id="plan-features-title">${content.featuresHeading}</h4>
				<ul class="plan__feature-list" aria-labelledby="plan-features-title">
					${features.map(
						feature =>
							html`<li class="plan__feature">
								<code-icon icon=${content.locked ? 'lock' : 'check'} aria-hidden="true"></code-icon
								><span>${feature}</span>
							</li>`,
					)}
				</ul>
			</div>
			${this.renderUpsell(sub)}
		</div>`;
	}

	/**
	 * The next-tier upsell, shown to paid plans below Advanced — the same guard the account chip uses.
	 * The target is the NEXT paid tier up, not Advanced flat: Student sits below Pro, so pitching Advanced
	 * there would skip a tier and quote a price no student is being asked to jump to. This is also the plan
	 * `gitlens.plus.upgrade` itself resolves to when no plan is passed, so the label and the command agree.
	 */
	private renderUpsell(sub: Subscription) {
		if (!isSubscriptionPaid(sub) || compareSubscriptionPlans(this.planId, 'advanced') >= 0) return nothing;

		const plan = getSubscriptionNextPaidPlanId(sub);
		// "doubles" holds because the only plan this branch pitches Pro to is Student, whose 500K is half of
		// Pro's 1M — the figures come from the shared table so the claim can't quietly stop being true.
		const pitch =
			plan === 'advanced'
				? `Advanced adds self-hosted integrations and ${getSubscriptionPlanAiCredits('advanced', false)} AI credits/week.`
				: `Pro doubles your AI credits to ${getSubscriptionPlanAiCredits('pro', false)}/week.`;

		return html`<div class="plan__upsell">
			<span class="plan__upsell-text">${pitch}</span>
			<gl-button
				appearance="secondary"
				href=${createCommandLink<SubscriptionUpgradeCommandArgs>('gitlens.plus.upgrade', {
					plan: plan,
					source: 'account',
					detail: {
						location: 'settings-account:upsell-bar',
						organization: sub.activeOrganization?.id,
						plan: plan,
					},
				})}
				>Upgrade to ${getSubscriptionPlanName(plan)}${this.renderPromo(plan, 'icon', 'suffix')}</gl-button
			>
		</div>`;
	}

	private renderAiUsageCard(sub: Subscription) {
		// The signal outlives the account it describes — a sign-out's refresh has to round-trip before it
		// clears, so without this gate the previous account's usage card renders on a signed-out panel.
		if (sub.account == null) return nothing;

		const usage: AiUsageInfo | null | undefined = this._state.aiUsage.get();
		// `undefined` = not loaded yet, `null` = unavailable (on-premise orgs, or the fetch failed). The card
		// is supplementary to the plan above it, so neither warrants a skeleton or an error row.
		if (usage == null) return nothing;

		// The two sentinels mean opposite things and must NEVER collapse into each other: -1 is genuinely
		// unlimited, while 0 is "no weekly allowance at all" (e.g. trials, org-disabled AI). Rendering 0 as
		// unlimited — or as a 0/0 bar that reads as full — tells a user with nothing that they have
		// everything. Neither sentinel has a ratio to draw, so both suppress the bar (as gk.dev does).
		let figure: string;
		let percent: number | undefined;
		if (usage.limit === -1) {
			figure = 'Unlimited';
		} else if (usage.limit === 0) {
			figure = 'No weekly allowance';
		} else {
			figure = `${compactNumberFormatter.format(usage.used)} of ${compactNumberFormatter.format(usage.limit)} ${aiUsageUnit}`;
			percent = Math.min(100, Math.max(0, (usage.used / usage.limit) * 100));
		}

		// gk.dev warns as the allowance runs out; the "Nearly out" text carries the same warning in words so
		// the amber fill is never the only signal (docs/accessibility.md).
		const nearlyOut = percent != null && percent > 90;

		return html`<div class="card ai">
			<div class="ai__head">
				<code-icon class="ai__icon" icon="sparkle" aria-hidden="true"></code-icon>
				<h3 class="ai__title">GitKraken AI Usage</h3>
				${nearlyOut ? html`<span class="ai__warning">Nearly out</span>` : nothing}
				<span class="ai__figure">${figure}</span>
			</div>
			${
				percent != null
					? html`<div class="ai__track" aria-hidden="true">
							<div
								class="ai__fill ${nearlyOut ? 'ai__fill--warning' : ''}"
								style=${cspStyleMap({ inlineSize: `${percent}%` })}
							></div>
						</div>`
					: nothing
			}
			${usage.organization != null ? this.renderAiOrgPool(usage.organization) : nothing}
			${
				// The sentinels suppress the reset line just as they suppress the bar: "resets Monday"
				// refers to a finite weekly allowance, which "Unlimited" and "No weekly allowance" have
				// each just said doesn't exist.
				percent != null ? this.renderAiReset(usage.resetsOn) : nothing
			}
		</div>`;
	}

	/**
	 * The organization's shared pool — 20% of every seat's weekly allowance funds it, which is why the
	 * personal `limit` above lands below the per-week figure the plan card states; without this line the two
	 * numbers read as a bug. Text only, and no ratio bar: the card gets one meter, and this pool is the
	 * whole org's draw rather than an allowance this user can spend down.
	 */
	private renderAiOrgPool(organization: NonNullable<AiUsageInfo['organization']>) {
		// The same two sentinels as the personal figure, kept just as distinct: -1 is genuinely unlimited,
		// 0 is no shared pool at all, and neither has a ratio to state.
		let figure: string;
		if (organization.limit === -1) {
			figure = 'Unlimited';
		} else if (organization.limit === 0) {
			figure = 'No shared allowance';
		} else {
			figure = `${compactNumberFormatter.format(organization.used)} of ${compactNumberFormatter.format(organization.limit)} ${aiUsageUnit}`;
		}

		return html`<p class="ai__org">Organization pool &middot; ${figure}</p>`;
	}

	private renderAiReset(resetsOn: AiUsageInfo['resetsOn']) {
		const date = new Date(resetsOn);
		// An absent or unparseable date must not reach the screen as "Invalid Date" — drop the line instead
		if (Number.isNaN(date.getTime())) return nothing;

		return html`<p class="ai__reset">Weekly allowance resets ${formatDate(date, 'dddd, MMMM Do')}</p>`;
	}

	private renderOrganizationCard(sub: Subscription) {
		const organization = sub.activeOrganization;
		if (!organization?.name) return nothing;

		const orgCount = this._subscription.organizationsCount.get();
		const canSwitch = orgCount > 1;
		const meta = canSwitch
			? `Active organization · you are in ${pluralize('organization', orgCount - 1, { infix: ' other ' })}`
			: 'Active organization';

		return html`<div class="card org">
			<code-icon class="org__icon" icon="organization" aria-hidden="true"></code-icon>
			<div class="org__text">
				<h3 class="org__name">${organization.name}</h3>
				<p class="org__meta">${meta}</p>
			</div>
			${
				canSwitch
					? html`<gl-button
							class="button--quiet"
							appearance="secondary"
							href=${createCommandLink<Source>('gitlens.gk.switchOrganization', {
								source: 'account',
								detail: { organization: organization.id },
							})}
							aria-label="Switch Active Organization"
							><code-icon icon="arrow-swap" slot="prefix" aria-hidden="true"></code-icon>
							Switch</gl-button
						>`
					: nothing
			}
		</div>`;
	}

	/** Refer-a-friend, shown to paid subscriptions only — the same guard the account chip uses. */
	private renderReferFriendCard(sub: Subscription) {
		if (!isSubscriptionPaid(sub)) return nothing;

		return html`<div class="refer">
			<code-icon class="refer__icon" icon="gift" aria-hidden="true"></code-icon>
			<span class="refer__text">Give a friend 50% off and get up to $20 in credit.</span>
			<a
				href=${createCommandLink<Source>('gitlens.plus.referFriend', {
					source: 'account',
					detail: { location: 'settings-account:refer' },
				})}
				>Refer a friend</a
			>
		</div>`;
	}

	private renderFooter(sub: Subscription) {
		return html`<div class="footer">
			<a
				href=${createCommandLink<Source>('gitlens.plus.manage', {
					source: 'account',
					detail: { location: 'settings-account:footer' },
				})}
				>Manage subscription</a
			>
			<a
				href=${createCommandLink<Source>('gitlens.plus.showPlans', {
					source: 'account',
					detail: { location: 'settings-account:footer' },
				})}
				>Compare plans</a
			>
			<a href=${urls.communityVsPro}>Community vs Pro</a>
			<span class="footer__note">${this.getPlanFootnote(sub)}</span>
		</div>`;
	}

	private renderPromo(plan: PromoPlans, type: GlPromo['type'] = 'info', slot?: string): unknown {
		return html`<gl-promo
			slot=${ifDefined(slot)}
			.promoPromise=${this._promos.getApplicablePromo(plan, 'account')}
			.type=${type}
			.source=${{ source: 'account' } as const}
		></gl-promo>`;
	}

	// ── Content builders ──

	/**
	 * The six subscription states, collapsed into what the plan card renders.
	 *
	 * NOTE: `Community` occurs both signed-OUT and signed-IN (a `community-with-account` plan), so nothing
	 * here may infer account presence from the state — the identity card, the refer card, and the
	 * "Already have a GitKraken account?" line all gate on `subscription.account` instead.
	 */
	private getPlanCardContent(sub: Subscription): PlanCardContent {
		const organizationId = sub.activeOrganization?.id;

		switch (sub.state) {
			case SubscriptionState.Paid: {
				const tier = getSubscriptionPlanName(this.planId);
				return {
					title: 'GitLens Pro',
					// The headline already names Pro, so a PRO badge beside it would only restate it
					tier: tier === 'Pro' || tier === 'Community' ? undefined : tier,
					meta: this.getPaidMeta(sub),
					featuresHeading: 'Included in your plan',
					locked: false,
				};
			}

			case SubscriptionState.Trial: {
				// A trial's tier rides on the EFFECTIVE plan (what the trial grants), not the actual one
				const tier = getSubscriptionPlanName(this.effectivePlanId);
				const named = tier !== 'Pro' && tier !== 'Community';
				const days = this.getTrialDaysRemaining(sub);
				const totalDays = this.getTrialTotalDays(sub);

				return {
					title: 'GitLens Pro',
					tier: named ? tier : undefined,
					status: 'Trial',
					meta: `${
						days < 1 ? 'Less than a day' : `${days} of ${totalDays} days`
					} left in your ${tier === 'Student' ? 'Student' : 'Pro'} trial. When it ends, Pro features keep working on publicly-hosted repos only.`,
					cta: {
						label: 'Upgrade to Pro',
						href: this.createUpgradeLink('pro', organizationId),
						promo: 'pro',
					},
					featuresHeading: 'Included during your trial',
					locked: false,
					trialRemaining: this.getTrialRemaining(sub),
				};
			}

			case SubscriptionState.TrialExpired:
				return {
					title: 'GitLens Community',
					meta: `${this.getTrialEndedSentence(sub)} Pro features now work on publicly-hosted repos only.`,
					cta: {
						label: 'Upgrade to Pro',
						href: this.createUpgradeLink('pro', organizationId),
						promo: 'pro',
					},
					featuresHeading: 'What GitLens Pro unlocks',
					locked: true,
				};

			case SubscriptionState.TrialReactivationEligible:
				return {
					title: 'GitLens Community',
					meta: `Reactivate your GitLens Pro trial and experience all the new Pro features — free for another ${pluralize('day', proTrialLengthInDays)}.`,
					cta: {
						label: 'Reactivate GitLens Pro Trial',
						href: createCommandLink<Source>('gitlens.plus.reactivateProTrial', {
							source: 'account',
							detail: { location: 'settings-account:plan-card' },
						}),
					},
					featuresHeading: 'What GitLens Pro unlocks',
					locked: true,
				};

			case SubscriptionState.VerificationRequired:
				return {
					title: 'GitLens Pro',
					status: 'Unverified',
					meta: 'Your Pro trial starts as soon as your email is verified.',
					featuresHeading: 'What GitLens Pro unlocks',
					locked: true,
				};

			default: {
				// Community — and anything unrecognized, which is the safest fallback to land on
				const hasAccount = sub.account != null;
				return {
					title: 'GitLens Community',
					meta: `You are using GitLens Community. ${
						hasAccount ? 'Start' : 'Sign in to start'
					} a ${proTrialLengthInDays}-day Pro trial — no credit card required.`,
					cta: {
						label: 'Try GitLens Pro',
						href: createCommandLink<Source>('gitlens.plus.signUp', {
							source: 'account',
							detail: { location: 'settings-account:plan-card' },
						}),
						promo: 'pro',
					},
					showSignInLine: !hasAccount,
					featuresHeading: 'What GitLens Pro unlocks',
					locked: true,
				};
			}
		}
	}

	private createUpgradeLink(plan: 'pro' | 'advanced', organizationId: string | undefined): string {
		return createCommandLink<SubscriptionUpgradeCommandArgs>('gitlens.plus.upgrade', {
			plan: plan,
			source: 'account',
			detail: { location: 'settings-account:plan-card', organization: organizationId, plan: plan },
		});
	}

	/** "Renews …" / "Ends …". The billing cadence isn't stated — check-in carries no such field. */
	private getPaidMeta(sub: Subscription): string {
		const { actual } = sub.plan;
		const expires = actual.expiresOn != null ? new Date(actual.expiresOn) : undefined;
		if (expires == null || Number.isNaN(expires.getTime())) {
			return `Your ${getSubscriptionPlanName(actual.id)} plan is active.`;
		}

		return `${actual.cancelled ? 'Ends' : 'Renews'} ${formatDate(expires, planDateFormat)}`;
	}

	/**
	 * Once a trial expires the effective plan falls back to `community-with-account`, which carries no
	 * expiry — so the end date often isn't recoverable. Say so without a date rather than invent one.
	 */
	private getTrialEndedSentence(sub: Subscription): string {
		const raw = sub.plan.effective.expiresOn ?? sub.plan.actual.expiresOn;
		const ended = raw != null ? new Date(raw) : undefined;
		if (ended == null || Number.isNaN(ended.getTime())) return 'Your Pro trial has ended.';

		return `Your Pro trial ended ${formatDate(ended, planDateFormat)}.`;
	}

	/**
	 * The actual trial window, resolved once so the "N of M days left" sentence and the progress bar's fill
	 * (`getTrialRemaining`) can never drift apart by computing it separately — see the note above the bar's
	 * markup for what happens when they do. `undefined` when the dates can't be resolved: missing,
	 * unparseable, or an end at or before start.
	 */
	private getTrialWindow(sub: Subscription): { start: number; end: number } | undefined {
		const { effective } = sub.plan;
		const start = new Date(effective.startedOn).getTime();
		const end = effective.expiresOn != null ? new Date(effective.expiresOn).getTime() : Number.NaN;
		if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return undefined;

		return { start: start, end: end };
	}

	/** Remaining share (0–100) of the trial window, or `undefined` when the window can't be resolved. */
	private getTrialRemaining(sub: Subscription): number | undefined {
		const window = this.getTrialWindow(sub);
		if (window == null) return undefined;

		return Math.min(100, Math.max(0, ((window.end - Date.now()) / (window.end - window.start)) * 100));
	}

	/**
	 * The trial window's actual length in days — falls back to the nominal `proTrialLengthInDays` when the
	 * window can't be resolved, so a reactivated trial or a backend-set date still gets a sane denominator.
	 */
	private getTrialTotalDays(sub: Subscription): number {
		const window = this.getTrialWindow(sub);
		if (window == null) return proTrialLengthInDays;

		return getDateDifference(window.start, window.end, 'days', Math.round);
	}

	/**
	 * Days left in the trial, clamped to `[0, total]`. Rounding `end - now` alone (as
	 * `getSubscriptionTimeRemaining` does) is unclamped, so a trial that just started can read one day over
	 * its own total — e.g. "15 of 14 days" — since `expiresOn` usually lands a few hours into what's really
	 * the final day. Clamping against this SAME window's total (not the nominal constant) keeps the
	 * sentence honest even when the actual window is longer or shorter than `proTrialLengthInDays`.
	 */
	private getTrialDaysRemaining(sub: Subscription): number {
		const window = this.getTrialWindow(sub);
		if (window == null) return 0;

		const remaining = getDateDifference(Date.now(), window.end, 'days', Math.round);
		return Math.min(this.getTrialTotalDays(sub), Math.max(0, remaining));
	}

	private getPlanFootnote(sub: Subscription): string {
		switch (sub.state) {
			case SubscriptionState.Paid:
				// Not `plan.actual.organizationId` — personal plans carry a placeholder id.
				return sub.activeOrganization?.name ? 'Managed by your organization' : 'Plan managed on gitkraken.dev';

			case SubscriptionState.Trial: {
				const expires =
					sub.plan.effective.expiresOn != null ? new Date(sub.plan.effective.expiresOn) : undefined;
				if (expires == null || Number.isNaN(expires.getTime())) return 'No credit card required to upgrade';

				return `Trial ends ${formatDate(expires, planDateFormat)}`;
			}

			case SubscriptionState.TrialExpired:
			case SubscriptionState.TrialReactivationEligible:
				return 'No credit card required to upgrade';

			case SubscriptionState.VerificationRequired:
				return sub.account?.email ? `Sent to ${sub.account.email}` : 'Check your inbox to verify your email';

			default:
				return 'Community is free, forever';
		}
	}
}
