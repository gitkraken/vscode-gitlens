import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { when } from 'lit/directives/when.js';
import { pluralize } from '@gitlens/utils/string.js';
import { urls } from '../../../../../constants.js';
import { proTrialLengthInDays, SubscriptionState } from '../../../../../constants.subscription.js';
import type { Source } from '../../../../../constants.telemetry.js';
import type { PromoPlans } from '../../../../../plus/gk/models/promo.js';
import type { SubscriptionUpgradeCommandArgs } from '../../../../../plus/gk/models/subscription.js';
import {
	compareSubscriptionPlans,
	getSubscriptionEntitlement,
	getSubscriptionPlanName,
	getSubscriptionProductPlanName,
	getSubscriptionProductPlanNameFromState,
	getSubscriptionTimeRemaining,
	isSubscriptionPaid,
	isSubscriptionTrial,
} from '../../../../../plus/gk/utils/subscription.utils.js';
import { createCommandLink } from '../../../../../system/commands.js';
import type { GlPopover } from '../../../shared/components/overlays/popover.js';
import type { GlPromo } from '../../../shared/components/promo.js';
import { focusableBaseStyles } from '../../../shared/components/styles/lit/a11y.css.js';
import { elementBase, linkBase } from '../../../shared/components/styles/lit/base.css.js';
import type { PromosContext } from '../../../shared/contexts/promos.js';
import { promosContext } from '../../../shared/contexts/promos.js';
import type { SubscriptionContextState } from '../../../shared/contexts/subscription.js';
import { subscriptionContext } from '../../../shared/contexts/subscription.js';
import { accountRingStyles } from './accountRing.css.js';
import { chipStyles } from './chipStyles.js';
import { ruleStyles } from './vscode.css.js';
import '../../../shared/components/badges/badge.js';
import '../../../shared/components/button.js';
import '../../../shared/components/button-container.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/overlays/popover.js';

@customElement('gl-account-chip')
export class GlAccountChip extends SignalWatcher(LitElement) {
	@consume({ context: subscriptionContext, subscribe: true })
	private _subscription!: SubscriptionContextState;

	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = [
		elementBase,
		linkBase,
		focusableBaseStyles,
		accountRingStyles,
		chipStyles,
		ruleStyles,
		css`
			:host {
				display: inline-flex;
				gap: var(--gl-space-8);
				align-items: center;
			}

			:host([display='panel']) .content {
				width: 100%;
			}

			:host-context(.vscode-dark),
			:host-context(.vscode-high-contrast) {
				--gl-account-chip-color: color-mix(in lab, var(--vscode-sideBar-background), #fff 10%);
				--gl-account-chip-media-color: color-mix(in lab, var(--vscode-sideBar-background), #fff 25%);
				--gl-account-account-media-color: color-mix(in lab, var(--vscode-sideBar-background), #fff 20%);
			}

			:host-context(.vscode-light),
			:host-context(.vscode-high-contrast-light) {
				--gl-account-chip-color: color-mix(in lab, var(--vscode-sideBar-background), #000 7%);
				--gl-account-chip-media-color: color-mix(in lab, var(--vscode-sideBar-background), #000 18%);
				--gl-account-account-media-color: color-mix(in lab, var(--vscode-sideBar-background), #000 15%);
			}

			.chip {
				padding-right: var(--gl-space-6);
				font-size: var(--gl-font-sm);
				font-weight: 400;
				line-height: 2rem;
				text-transform: uppercase;
				background-color: var(--gl-account-chip-color);
			}

			.chip--outlined {
				background-color: transparent;
				border: var(--gl-border-width) solid var(--gl-account-chip-color);
			}

			.chip__media {
				display: flex;
				flex: 0 0 auto;
				align-items: center;
				justify-content: center;
				padding: var(--gl-space-2);
			}

			img.chip__media {
				width: 1.6rem;
				aspect-ratio: 1 / 1;
				background-color: var(--gl-account-chip-media-color);
				border-radius: 50%;
			}

			.chip-group {
				display: inline-flex;
				flex-direction: row;
				gap: var(--gl-space-8);
				cursor: pointer;
			}

			.account-info {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-4);
			}

			.row {
				position: relative;
				display: flex;
				flex-direction: row;
				gap: 0 var(--gl-space-6);
				align-items: center;
			}

			.row:last-of-type {
				margin-bottom: var(--gl-space-6);
			}

			/* The headline is a name plus badges now, so it lays out as a row instead of one ellipsising
			   string — "GitLens Pro" is short enough that it no longer needs to truncate. */
			.header__title {
				display: flex;
				flex-wrap: wrap;
				gap: var(--gl-space-6);
				align-items: center;
				overflow: visible;
			}

			/* Squared off from gl-badge's pill default and tightened — at title size the elliptical shape read as
			   a control sitting next to the name rather than a label on it. Overridden here rather than on the
			   shared default, which other surfaces still want as a pill.

			   The badge text is all-caps with no descenders, so it sits on the box's floor and reads low. The
			   bottom padding buys back the room those missing descenders would have occupied, and align-items
			   centers the anonymous text item that gl-badge's inline-flex would otherwise stretch. */
			.header__title gl-badge::part(base) {
				align-items: center;
				padding: 0 var(--gl-space-4) var(--gl-space-2);
				border-radius: var(--gl-radius-sm);
			}

			/* gl-badge's host sets no display of its own, so as a flex item it blockifies to a box whose height
			   comes from the INHERITED strut — the title's own tall line — and the badge inside was then placed by
			   that strut's baseline, riding well below the title's text. Giving the host a display makes its box
			   the badge itself, so the row's align-items can actually center it. */
			.header__title gl-badge {
				display: inline-flex;
				align-items: center;
			}

			/* Accents the TIER badge; the status badges keep gl-badge's neutral default (see renderPlanTitle). */
			.plan-tier {
				--gl-badge-color: var(--vscode-textLink-foreground);
			}

			/* Recessed grey sub-chip carved into the tier pill. Styled here rather than with gl-badge's
			   appearance="muted" because that variant's palette is tuned to sit inside a FILLED badge
			   (--vscode-badge-foreground on its own tint), and overriding it through ::part would need
			   !important to outrank the component's internal .badge class. Inherits the pill's small-caps. */
			.plan-trial {
				display: flex;
				flex: 0 0 auto;
				align-items: center;

				/* Bleeds to the pill's inner edges rather than floating in its padding: stretch fills the
				   content box vertically, and the negative right/bottom margins reach back across the
				   padding the tier text needs, so the grey ends flush against the border. Only the trailing
				   corners are rounded — the leading edge butts up against the tier text. */
				align-self: stretch;

				/* Mirrors the pill's own vertical padding so the sub-chip's text centers in the same optical
				   box as the tier text. Without it the chip centers over the full bled height while the tier
				   text centers above the bottom padding, and the two labels sit a pixel apart. */
				padding: 0 var(--gl-space-4) var(--gl-space-2);
				margin: 0 calc(var(--gl-space-4) * -1) calc(var(--gl-space-2) * -1) var(--gl-space-4);
				font-weight: 500;
				color: var(--color-foreground--65);
				background-color: color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
				border-radius: 0 var(--gl-radius-xs) var(--gl-radius-xs) 0;
			}

			/* Trial countdown, alongside the pills rather than inside one — see renderPlanTitle. Sits a step
			   below the badges in the foreground ladder: it's supporting detail, and the body restates it. */
			.plan-remaining {
				font-size: var(--gl-font-sm);
				color: var(--color-foreground--50);
				white-space: nowrap;
			}

			/* The upgrade CTA rides the account row's right edge, and wraps under the name/email when they
			   leave it no room — better than squeezing either side in a narrow panel. */
			.row--account {
				flex-wrap: wrap;
				row-gap: var(--gl-space-6);
			}

			.row--account .details {
				min-width: 14rem;
			}

			.row--account .details__button {
				margin-inline-start: auto;
			}

			.row__media {
				display: flex;
				flex: 0 0 auto;
				align-items: center;
				justify-content: center;
				width: 3.4rem;
			}

			.row__media code-icon {
				color: var(--color-foreground--65);
			}

			/* Ring matches the Graph header's account pill (accountRing.css.ts) so the same entitlement reads
			   the same in the toolbar and in the panel it opens. Only the photo gets it — the no-avatar
			   fallback is a square-ish glyph, and a circular ring around it would read as a mistake.

			   Never gate the ring color on --vscode-contrastBorder: any theme can set it, and setting it to the
			   theme's own background is the standard way to suppress VS Code's default hairlines, which would
			   paint the ring in the background color and erase the state. */
			.row__media img {
				width: 2rem;
				aspect-ratio: 1 / 1;
				background-color: var(--gl-account-account-media-color);
				border-radius: 50%;
				box-shadow: 0 0 0 var(--gl-account-ring-width) var(--gl-account-ring-color);
			}

			/* Forced-colors mode drops box-shadow; repaint the ring as an outline, which survives and is
			   equally layout-free. */
			@media (forced-colors: active) {
				.row__media img {
					outline: 0.1rem solid ButtonBorder;
					outline-offset: 0.1rem;
				}
			}

			.details {
				display: flex;
				flex: 1;
				flex-direction: column;
				justify-content: center;
			}

			.details__title {
				margin: 0;
				font-size: var(--gl-font-base);
				font-weight: 600;
			}

			.details__subtitle {
				margin: 0;
				font-size: var(--gl-font-sm);
				font-weight: 400;
				color: var(--color-foreground--65);
			}

			.details__button {
				display: flex;
				flex: none;
				flex-direction: row;
				gap: var(--gl-space-2);
				align-items: center;
				justify-content: center;
			}

			.org__badge {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				width: 2.4rem;
				height: 2.4rem;
				margin-right: var(--gl-space-6);
				font-size: var(--gl-font-micro);
				font-weight: 600;
				line-height: 2.4rem;
				color: var(--color-foreground--65);
				background-color: var(--vscode-toolbar-hoverBackground);
				border-radius: 50%;
			}

			.account-status > p {
				margin-block: var(--gl-space-6);
			}

			.account-status > :first-child {
				margin-block-start: 0;
			}

			.account-status > :last-child {
				margin-block-end: 0;
			}

			button-container {
				margin-bottom: 1.3rem;
			}

			button-container .button-suffix {
				display: inline-flex;
				gap: 0.2em;
				align-items: center;
				margin-left: var(--gl-space-4);
				white-space: nowrap;
			}

			.upgrade > * {
				margin-block: var(--gl-space-8) 0;
			}

			.upgrade ul {
				padding-inline-start: var(--gl-space-20);
			}

			.upgrade li {
				text-wrap: pretty;
			}

			.upgrade gl-promo::part(text) {
				margin-block-start: 0;

				/* border-radius: 0.3rem;
		padding: var(--gl-space-2) var(--gl-space-4);
		background-color: var(--gl-account-chip-color); */
			}

			.upgrade gl-promo:not([has-promo]) {
				display: none;
			}

			.upgrade-button {
				font-size: var(--gl-font-micro);
				text-transform: uppercase;
			}

			@keyframes shimmer {
				100% {
					transform: translateX(100%);
				}
			}

			.chip--skeleton {
				position: relative;
				width: 8rem;
				height: 2.4rem;
				overflow: hidden;
				cursor: default;
				background-color: var(--gl-account-chip-color);
			}

			.chip--skeleton::before {
				position: absolute;
				inset: 0;
				content: '';
				background-image: linear-gradient(
					to right,
					transparent 0%,
					var(--color-background--lighten-15) 20%,
					var(--color-background--lighten-30) 60%,
					transparent 100%
				);
				transform: translateX(-100%);
				animation: shimmer 2s var(--gl-ease-in-out) infinite;
			}
		`,
	];

	/** Controls whether this renders as the compact popover-triggering chip, or just the account panel content. */
	@property({ reflect: true }) display: 'chip' | 'panel' = 'chip';

	/** When set, the panel's account-management cog deep-links to the in-editor Settings → Account
	 *  view instead of the external gk.dev account page. Set by surfaces outside Settings (e.g. the
	 *  Graph header account rollup) that need a way into the full account screen; the Settings page
	 *  leaves it unset so its own chip keeps the external "Manage Account" action (and isn't circular). */
	@property({ type: Boolean, reflect: true, attribute: 'settings-nav' })
	settingsNav = false;

	private _showUpgrade = false;
	@property({ type: Boolean, reflect: true, attribute: 'show-upgrade' })
	get showUpgrade() {
		return this._showUpgrade;
	}
	private set showUpgrade(value: boolean) {
		this._showUpgrade = value;
	}

	@query('#chip')
	private _chip!: HTMLElement;

	@query('gl-popover')
	private _popover!: GlPopover;

	private get accountAvatar() {
		return this.hasAccount && this._subscription.avatar.get();
	}

	private get accountName() {
		return this.subscription?.account?.name ?? '';
	}

	private get accountEmail() {
		return this.subscription?.account?.email ?? '';
	}

	private get hasAccount() {
		return this.subscription?.account != null;
	}

	get isReactivatedTrial(): boolean {
		return (
			this.subscriptionState === SubscriptionState.Trial &&
			(this.subscription?.plan.effective.trialReactivationCount ?? 0) > 0
		);
	}
	/** Drives the account avatar's entitlement ring — matches the Graph header's account pill. */
	private get entitlement() {
		return getSubscriptionEntitlement(this._subscription.subscription.get()?.state);
	}

	private get planId() {
		return this._subscription.subscription.get()?.plan.actual.id ?? 'pro';
	}
	private get effectivePlanId() {
		return this._subscription.subscription.get()?.plan.effective.id ?? 'pro';
	}

	private get planName() {
		return getSubscriptionProductPlanNameFromState(
			this.subscriptionState ?? SubscriptionState.Community,
			this.planId,
			this.effectivePlanId,
		);
	}

	private get planTier() {
		const sub = this.subscription;
		if (sub != null && isSubscriptionTrial(sub)) {
			return sub.plan.effective.id === 'student' ? 'Student' : 'Pro Trial';
		}

		return getSubscriptionPlanName(this.planId);
	}

	@consume({ context: promosContext })
	private promos!: PromosContext;

	private get subscription() {
		return this._subscription.subscription.get();
	}

	private get subscriptionState() {
		return this.subscription?.state;
	}

	private get trialDaysRemaining() {
		if (this.subscription == null) return 0;

		return getSubscriptionTimeRemaining(this.subscription, 'days') ?? 0;
	}

	override focus(): void {
		this._chip.focus();
	}

	override render(): unknown {
		// Don't show account state until subscription data has loaded.
		// subscription starts as undefined; even Community users have a Subscription object.
		if (this.subscription === undefined) {
			return html`<span
				id="chip"
				class="chip chip--skeleton"
				tabindex="-1"
				aria-label="Loading account status"
				role="status"
			></span>`;
		}

		if (this.display === 'panel') {
			return html`<div class="content">${this.renderPanelContent()}</div>`;
		}

		return html`<gl-popover placement="bottom" trigger="hover focus click">
				<span id="chip" slot="anchor" class="chip" tabindex="0">
					${
						this.accountAvatar
							? html`<img class="chip__media" src=${this.accountAvatar} />`
							: html`<code-icon class="chip__media" icon="gl-gitlens" size="16"></code-icon>`
					}
					<span>${this.planTier}</span>
				</span>
				<div slot="content" class="content" tabindex="-1">${this.renderPanelContent()}</div>
			</gl-popover>
			${this.renderUpgradeContent()}`;
	}

	show(): void {
		void this._popover.show();
		this.focus();
	}

	/** The account panel body: header (plan name + toolbar actions) + account info + subscription-state CTAs. */
	private renderPanelContent(): unknown {
		return html`<div class="header">
				${this.renderPlanTitle()}
				<span class="header__actions">
					${
						this.hasAccount
							? html`<gl-button
										appearance="toolbar"
										href="${createCommandLink<Source>('gitlens.plus.validate', {
											source: 'account',
										})}"
										tooltip="Synchronize Status"
										aria-label="Synchronize Status"
										><code-icon icon="sync"></code-icon
									></gl-button>
									${
										this.settingsNav
											? html`<gl-button
													appearance="toolbar"
													href="${createCommandLink('gitlens.showSettingsPage!account')}"
													tooltip="Account Settings"
													aria-label="Account Settings"
													><code-icon icon="gear"></code-icon
												></gl-button>`
											: html`<gl-button
													appearance="toolbar"
													href="${createCommandLink<Source>('gitlens.plus.manage', {
														source: 'account',
													})}"
													tooltip="Manage Account"
													aria-label="Manage Account"
													><code-icon icon="gear"></code-icon
												></gl-button>`
									}
									<gl-button
										appearance="toolbar"
										href="${createCommandLink<Source>('gitlens.plus.logout', {
											source: 'account',
										})}"
										tooltip="Sign Out"
										aria-label="Sign Out"
										><code-icon icon="sign-out"></code-icon
									></gl-button>`
							: nothing
					}
				</span>
			</div>
			${this.renderAccountInfo()} ${this.renderAccountState()}`;
	}

	/**
	 * The panel's plan headline. Everything paid or trialling reads as one product — GitLens Pro — with what
	 * varies split into two DELIBERATELY distinct badges: the TIER (Advanced / Business / Enterprise /
	 * Student, what was bought) takes the accent, while STATUS (trialling, unverified) stays neutral. Sharing
	 * a treatment would make an upgrade and a countdown read as the same kind of claim.
	 *
	 * Community and the post-trial states aren't Pro, so they keep the name they already had and take no
	 * badge. Only the panel changes — the collapsed chip still leads with the tier.
	 */
	private renderPlanTitle(): unknown {
		const state = this.subscriptionState ?? SubscriptionState.Community;
		if (
			state === SubscriptionState.Community ||
			state === SubscriptionState.TrialExpired ||
			state === SubscriptionState.TrialReactivationEligible
		) {
			return html`<span class="header__title">${this.planName}</span>`;
		}

		const trial = state === SubscriptionState.Trial;
		// A trial's tier rides on the EFFECTIVE plan (what the trial grants); a paid plan's on the actual one.
		const tier = getSubscriptionPlanName(trial ? this.effectivePlanId : this.planId);
		const days = trial ? this.trialDaysRemaining : 0;
		const hasTier = tier !== 'Pro' && tier !== 'Community';

		return html`<span class="header__title"
			>${getSubscriptionProductPlanName('pro')}${when(
				hasTier,
				// Trialling a named tier reads as one claim, not two competing pills: the status rides inside
				// the tier pill as a recessed grey sub-chip.
				() =>
					html`<gl-badge class="plan-tier"
						>${tier}${when(trial, () => html`<span class="plan-trial">Trial</span>`)}</gl-badge
					>`,
			)}${when(
				trial && !hasTier,
				// A Pro trial has no tier pill to nest into — the headline already names Pro, so a PRO badge
				// beside it would only restate it — so the status stands as its own neutral badge.
				() => html`<gl-badge>Trial</gl-badge>`,
			)}${when(
				state === SubscriptionState.VerificationRequired,
				() => html`<gl-badge>Unverified</gl-badge>`,
			)}${when(
				trial && days !== 0,
				// The countdown is a measurement, not a label — it changes daily and would resize a badge as it
				// counts down, so it rides alongside as text. The panel body states it in full below.
				() => html`<span class="plan-remaining">${days < 1 ? '<1d' : `${days}d`} left</span>`,
			)}</span
		>`;
	}

	private renderAccountInfo() {
		const sub = this._subscription.subscription.get();
		const avatar = this._subscription.avatar.get();
		const orgCount = this._subscription.organizationsCount.get();
		const organization = sub?.activeOrganization?.name ?? '';
		// Only the account itself is required — a solo account has no active organization, and gating on one
		// hid the avatar, name, and email from every user who isn't in an org. The organization row below
		// carries its own guard.
		if (!this.hasAccount) return nothing;

		return html`<div class="account-info">
			<span class="row row--account">
				<span class="row__media" data-entitlement=${this.entitlement ?? 'loading'}
					>${
						avatar ? html`<img src=${avatar} />` : html`<code-icon icon="gl-gitlens" size="20"></code-icon>`
					}</span
				>
				<span class="details"
					><p class="details__title">${this.accountName}</p>
					<p class="details__subtitle">${this.accountEmail}</p></span
				>
				${this.renderUpgradeButton(sub?.activeOrganization?.id)}
			</span>
			${when(
				orgCount > 1 && organization.length > 0,
				() =>
					html`<span class="row">
						<span class="row__media"><code-icon icon="organization" size="20"></code-icon></span>
						<span class="details"><p class="details__title">${organization}</p></span>
						<div class="details__button">
							<gl-button
								appearance="toolbar"
								href="${createCommandLink<Source>('gitlens.gk.switchOrganization', {
									source: 'account',
									detail: {
										organization: sub?.activeOrganization?.id,
									},
								})}"
								aria-label="Switch Active Organization"
								><span class="org__badge">+${orgCount - 1}</span
								><code-icon icon="arrow-swap"></code-icon
								><span slot="tooltip"
									>Switch Active Organization
									<hr />
									You are in
									${pluralize('organization', orgCount - 1, {
										infix: ' other ',
									})}</span
								></gl-button
							>
						</div>
					</span>`,
			)}
		</div>`;
	}

	/** The Advanced upsell, shown to paid plans below Advanced. It rides the account row rather than a plan
	 *  row of its own — the plan is already named in the panel's header, so a row restating it was redundant. */
	private renderUpgradeButton(organizationId: string | undefined) {
		if (
			this.subscription == null ||
			!isSubscriptionPaid(this.subscription) ||
			compareSubscriptionPlans(this.planId, 'advanced') >= 0
		) {
			return nothing;
		}

		return html`<div class="details__button">
			<gl-button
				appearance="secondary"
				href="${createCommandLink<SubscriptionUpgradeCommandArgs>('gitlens.plus.upgrade', {
					plan: 'advanced',
					source: 'account',
					detail: {
						location: 'plan-section:upgrade-button',
						organization: organizationId,
						plan: 'advanced',
					},
				})}"
				aria-label="Upgrade to Advanced"
				><span class="upgrade-button">Upgrade</span>${this.renderPromo('advanced', 'icon', 'suffix')}
				<span slot="tooltip"
					>Upgrade to the Advanced plan for access to self-hosted integrations, advanced AI features @ 1M
					tokens/week, and more ${this.renderPromo('advanced', 'info')}
				</span>
			</gl-button>
		</div>`;
	}

	private renderAccountState() {
		const sub = this._subscription.subscription.get();

		switch (this.subscriptionState) {
			case SubscriptionState.Paid:
				return html`<div class="account-status">${this.renderReferFriend()}</div> `;

			case SubscriptionState.VerificationRequired:
				return html`<div class="account-status">
					<p>You must verify your email before you can access Pro features.</p>
					<button-container layout="editor">
						<gl-button
							full
							href="${createCommandLink<Source>('gitlens.plus.resendVerification', {
								source: 'account',
							})}"
							>Resend Email</gl-button
						>
						<gl-button
							appearance="secondary"
							href="${createCommandLink<Source>('gitlens.plus.validate', {
								source: 'account',
							})}"
							><code-icon size="20" icon="refresh"></code-icon>
						</gl-button>
					</button-container>
				</div>`;

			case SubscriptionState.Trial: {
				const days = this.trialDaysRemaining;

				return html`<div class="account-status">
					<p>
						You have
						<strong>${days < 1 ? '<1 day' : pluralize('day', days, { infix: ' more ' })} left</strong>
						in your ${this.planTier === 'Student' ? 'Student' : 'Pro'} trial. Once your trial ends, you will
						only be able to use Pro features on publicly-hosted repos.
					</p>
					<button-container layout="editor">
						<gl-button
							full
							href="${createCommandLink<SubscriptionUpgradeCommandArgs>('gitlens.plus.upgrade', {
								plan: 'pro',
								source: 'account',
								detail: {
									location: 'upgrade-button',
									organization: sub?.activeOrganization?.id,
									plan: 'pro',
								},
							})}"
							>Upgrade to Pro</gl-button
						>
					</button-container>
					${this.renderPromo('pro')} ${this.renderReferFriend()}
				</div>`;
			}

			case SubscriptionState.TrialExpired:
				return html`<div class="account-status">
					<p>Thank you for trying <a href="${urls.communityVsPro}">GitLens Pro</a>.</p>
					<p>Continue leveraging Pro features and workflows for privately hosted repos by upgrading today.</p>
					<button-container layout="editor">
						<gl-button
							full
							href="${createCommandLink<SubscriptionUpgradeCommandArgs>('gitlens.plus.upgrade', {
								plan: 'pro',
								source: 'account',
								detail: {
									location: 'upgrade-button',
									organization: sub?.activeOrganization?.id,
									plan: 'pro',
								},
							})}"
							>Upgrade to Pro</gl-button
						>
					</button-container>
					${this.renderPromo('pro')} ${this.renderReferFriend()}
				</div>`;

			case SubscriptionState.TrialReactivationEligible:
				return html`<div class="account-status">
					<p>
						Reactivate your GitLens Pro trial and experience all the new Pro features — free for another
						${pluralize('day', proTrialLengthInDays)}.
					</p>
					<button-container layout="editor">
						<gl-button
							full
							href="${createCommandLink<Source>('gitlens.plus.reactivateProTrial', {
								source: 'account',
							})}"
							tooltip="Reactivate your Pro trial for another ${pluralize('day', proTrialLengthInDays)}"
							>Reactivate GitLens Pro Trial</gl-button
						>
					</button-container>
					${this.renderReferFriend()}
				</div>`;

			default:
				return html`<div class="account-status">
					<p>
						Unlock advanced features and workflows for private repos, accelerate reviews, and streamline
						collaboration with
						<a href="${urls.communityVsPro}">GitLens Pro</a>.
					</p>
					<button-container layout="editor">
						<gl-button
							full
							href="${createCommandLink<Source>('gitlens.plus.signUp', {
								source: 'account',
							})}"
							>Try GitLens Pro</gl-button
						>
						<span class="button-suffix"
							>or
							<a
								href="${createCommandLink<Source>('gitlens.plus.login', {
									source: 'account',
								})}"
								>sign in</a
							></span
						>
					</button-container>
					<p>Get ${proTrialLengthInDays} days of GitLens Pro for free — no credit card required.</p>
				</div>`;
		}
	}

	private renderReferFriend() {
		if (this.subscription == null || !isSubscriptionPaid(this.subscription)) return nothing;

		return html`<p>
			<a
				href="${createCommandLink<Source>('gitlens.plus.referFriend', {
					source: 'account',
				})}"
				>Refer a friend</a
			>
			&mdash; give 50% off and get up to $20
		</p>`;
	}

	private renderUpgradeContent() {
		const sub = this._subscription.subscription.get();

		if (sub != null && isSubscriptionPaid(sub)) {
			this.showUpgrade = false;
			return nothing;
		}

		this.showUpgrade = true;

		return html`<gl-popover placement="bottom" trigger="hover focus click">
			<span slot="anchor" class="chip chip--outlined" tabindex="0">
				<span>Upgrade</span>
			</span>
			<div slot="content" class="content" tabindex="-1">
				<div class="header">
					<span class="header__title">Advantages of GitLens Pro</span>
				</div>
				<div class="upgrade">
					<button-container layout="editor">
						<gl-button
							full
							href="${createCommandLink<SubscriptionUpgradeCommandArgs>('gitlens.plus.upgrade', {
								plan: 'pro',
								source: 'account',
								detail: {
									location: 'upgrade-chip:upgrade-button',
									organization: sub?.activeOrganization?.id,
									plan: 'pro',
								},
							})}"
							>Upgrade to Pro</gl-button
						>
					</button-container>
					${this.renderPromo('pro')}

					<ul>
						<li>Unlimited cloud integrations</li>
						<li>Smart AI features &mdash; 250K tokens/week</li>
						<li>
							Powerful tools &mdash; Commit Graph, Visual History, &amp; Git Worktrees for private repos
						</li>
						<li>Streamlined workflows &mdash; start work from issues, pull request reviews</li>
					</ul>

					<br />
					<button-container>
						<gl-button
							full
							href="${createCommandLink<SubscriptionUpgradeCommandArgs>('gitlens.plus.upgrade', {
								plan: 'advanced',
								source: 'account',
								detail: {
									location: 'upgrade-chip:upgrade-button',
									organization: sub?.activeOrganization?.id,
									plan: 'advanced',
								},
							})}"
							>Upgrade to Advanced</gl-button
						>
					</button-container>
					${this.renderPromo('advanced')}

					<ul>
						<li>Self-hosted integrations</li>
						<li>Advanced AI features &mdash; 1M tokens/week</li>
					</ul>
				</div>
			</div>
		</gl-popover>`;
	}

	private renderPromo(plan: PromoPlans, type: GlPromo['type'] = 'info', slot?: string): unknown {
		return html`<gl-promo
			slot=${ifDefined(slot)}
			.promoPromise=${this.promos.getApplicablePromo(plan, 'account')}
			.type=${type}
			.source="${{ source: 'account' } as const}"
		></gl-promo>`;
	}
}
