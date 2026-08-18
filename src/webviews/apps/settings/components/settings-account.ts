import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
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
	getSubscriptionPlanName,
	getSubscriptionTimeRemaining,
	isSubscriptionPaid,
} from '../../../../plus/gk/utils/subscription.utils.js';
import { createCommandLink } from '../../../../system/commands.js';
import { accountRingStyles } from '../../plus/shared/components/accountRing.css.js';
import { cspStyleMap } from '../../shared/components/csp-style-map.directive.js';
import type { GlPromo } from '../../shared/components/promo.js';
import { boxSizingBase, linkBase } from '../../shared/components/styles/lit/base.css.js';
import type { PromosContext } from '../../shared/contexts/promos.js';
import { promosContext } from '../../shared/contexts/promos.js';
import type { SubscriptionContextState } from '../../shared/contexts/subscription.js';
import { subscriptionContext } from '../../shared/contexts/subscription.js';
import { formatDate } from '../../shared/date.js';
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

/** Absolute-date format used across the panel — the same one the commit surfaces use. */
const planDateFormat = 'MMMM Do, YYYY';

/**
 * Weekly GitKraken AI credit allowance, per plan. A trial carries its OWN, much smaller grant than the
 * plan it previews — reading the previewed plan's number here would overstate a trial's budget 4x.
 */
function getPlanAiCredits(planId: SubscriptionPlanIds, trial: boolean): string {
	if (trial) return '250K';

	switch (planId) {
		case 'student':
			return '500K';
		case 'advanced':
			return '2M';
		case 'teams':
			return '3M';
		case 'enterprise':
			return '4M';
		default:
			return '1M';
	}
}

/**
 * What the given plan includes. Each paid tier above Pro stacks on the one below it with an
 * "Everything in X" lead, mirroring how GitKraken's own pricing presents them, so the list stays short
 * enough to scan instead of restating four tiers' worth of bullets.
 */
function getPlanFeatures(planId: SubscriptionPlanIds, trial: boolean): string[] {
	const credits = `AI features — ${getPlanAiCredits(planId, trial)} credits/week`;

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
 * list, Advanced upsell), the active organization, refer-a-friend, and a footer link row.
 *
 * Account/plan state comes from the shared subscription RPC signals (via `subscriptionContext`, the same
 * bridge the Graph header and Home view use). Everything acts through command links — nothing here
 * writes config.
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

	private get trialDaysRemaining(): number {
		const sub = this.subscription;
		if (sub == null) return 0;

		return getSubscriptionTimeRemaining(sub, 'days') ?? 0;
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
		${this.renderOrganizationCard(sub)} ${this.renderReferFriendCard(sub)} ${this.renderFooter(sub)}`;
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
				// days left", where the picture and the number contradict each other.
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
		const pitch =
			plan === 'advanced'
				? 'Advanced adds self-hosted integrations and 2M AI credits/week.'
				: 'Pro doubles your AI credits to 1M/week.';

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
				const days = this.trialDaysRemaining;

				return {
					title: 'GitLens Pro',
					tier: named ? tier : undefined,
					status: 'Trial',
					meta: `${
						days < 1 ? 'Less than a day' : `${days} of ${proTrialLengthInDays} days`
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

	/** Remaining share (0–100) of the trial window, or `undefined` when the window can't be resolved. */
	private getTrialRemaining(sub: Subscription): number | undefined {
		const { effective } = sub.plan;
		const start = new Date(effective.startedOn).getTime();
		const end = effective.expiresOn != null ? new Date(effective.expiresOn).getTime() : Number.NaN;
		if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return undefined;

		return Math.min(100, Math.max(0, ((end - Date.now()) / (end - start)) * 100));
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
