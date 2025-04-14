import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import { urls } from '../../../../../constants';
import { proTrialLengthInDays, SubscriptionPlanId, SubscriptionState } from '../../../../../constants.subscription';
import type { Source } from '../../../../../constants.telemetry';
import type { SubscriptionUpgradeCommandArgs } from '../../../../../plus/gk/models/subscription';
import {
	compareSubscriptionPlans,
	getSubscriptionPlanTier,
	getSubscriptionStateName,
	getSubscriptionTimeRemaining,
	hasAccountFromSubscriptionState,
	isSubscriptionPaid,
	isSubscriptionStatePaidOrTrial,
	isSubscriptionTrial,
} from '../../../../../plus/gk/utils/subscription.utils';
import { createCommandLink } from '../../../../../system/commands';
import { pluralize } from '../../../../../system/string';
import type { State } from '../../../../home/protocol';
import { stateContext } from '../../../home/context';
import type { GlPopover } from '../../../shared/components/overlays/popover';
import { focusableBaseStyles } from '../../../shared/components/styles/lit/a11y.css';
import { elementBase, linkBase } from '../../../shared/components/styles/lit/base.css';
import type { PromosContext } from '../../../shared/contexts/promos';
import { promosContext } from '../../../shared/contexts/promos';
import { chipStyles } from './chipStyles';
import '../../../shared/components/button';
import '../../../shared/components/button-container';
import '../../../shared/components/code-icon';
import '../../../shared/components/overlays/popover';

@customElement('gl-account-chip')
export class GlAccountChip extends LitElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = [
		elementBase,
		linkBase,
		focusableBaseStyles,
		chipStyles,
		css`
			:host {
				display: inline-flex;
				align-items: center;
				gap: 0.8rem;
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
				padding-right: 0.6rem;

				font-size: 1.1rem;
				font-weight: 400;
				text-transform: uppercase;
				line-height: 2rem;
				background-color: var(--gl-account-chip-color);
			}

			.chip--outlined {
				background-color: transparent;
				border: 1px solid var(--gl-account-chip-color);
			}

			.chip__media {
				flex: 0 0 auto;
				display: flex;
				align-items: center;
				justify-content: center;
				padding: 0.2rem;
			}

			img.chip__media {
				width: 1.6rem;
				aspect-ratio: 1 / 1;
				border-radius: 50%;
				background-color: var(--gl-account-chip-media-color);
			}

			.chip-group {
				display: inline-flex;
				flex-direction: row;
				gap: 0.8rem;
				cursor: pointer;
			}

			.account-info {
				display: flex;
				flex-direction: column;
				gap: 0.2rem;
			}

			.row {
				position: relative;
				display: flex;
				flex-direction: row;
				gap: 0 0.6rem;
				align-items: center;
			}

			.row:last-of-type {
				margin-bottom: 0.6rem;
			}

			.row__media {
				flex: 0 0 auto;
				width: 3.4rem;
				display: flex;
				align-items: center;
				justify-content: center;
			}

			.row__media code-icon {
				color: var(--color-foreground--65);
			}

			.row__media img {
				width: 2rem;
				aspect-ratio: 1 / 1;
				border-radius: 50%;
				background-color: var(--gl-account-account-media-color);
			}

			.details {
				flex: 1;
				display: flex;
				flex-direction: column;
				justify-content: center;
			}

			.details__title {
				font-size: 1.3rem;
				font-weight: 600;
				margin: 0;
			}

			.details__subtitle {
				font-size: 1.1rem;
				font-weight: 400;
				margin: 0;
				color: var(--color-foreground--65);
			}

			.details__button {
				flex: none;
				display: flex;
				gap: 0.2rem;
				flex-direction: row;
				align-items: center;
				justify-content: center;
			}

			.org__badge {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				width: 2.4rem;
				height: 2.4rem;
				line-height: 2.4rem;
				font-size: 1rem;
				font-weight: 600;
				color: var(--color-foreground--65);
				background-color: var(--vscode-toolbar-hoverBackground);
				border-radius: 50%;
				margin-right: 0.6rem;
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
				align-items: center;
				white-space: nowrap;
				gap: 0.2em;
				margin-left: 0.4rem;
			}

			hr {
				border: none;
				border-top: 1px solid var(--color-foreground--25);
			}

			.upgrade > * {
				margin-block: 0.8rem 0;
			}

			.upgrade ul {
				padding-inline-start: 2rem;
			}

			.upgrade li {
				text-wrap: pretty;
			}

			.upgrade gl-promo::part(text) {
				margin-block-start: 0;
				/* border-radius: 0.3rem;
				padding: 0.2rem 0.4rem;
				background-color: var(--gl-account-chip-color); */
			}

			.upgrade gl-promo:not([has-promo]) {
				display: none;
			}

			.upgrade-button {
				text-transform: uppercase;
				font-size: 1rem;
			}
		`,
	];

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

	@consume<State>({ context: stateContext, subscribe: true })
	@state()
	private _state!: State;

	private get accountAvatar() {
		return this.hasAccount && this._state.avatar;
	}

	private get accountName() {
		return this.subscription?.account?.name ?? '';
	}

	private get accountEmail() {
		return this.subscription?.account?.email ?? '';
	}

	private get hasAccount() {
		return hasAccountFromSubscriptionState(this.subscriptionState);
	}

	get isReactivatedTrial(): boolean {
		return (
			this.subscriptionState === SubscriptionState.ProTrial &&
			(this.subscription?.plan.effective.trialReactivationCount ?? 0) > 0
		);
	}
	private get planId() {
		return this._state.subscription?.plan.actual.id ?? SubscriptionPlanId.Pro;
	}
	private get effectivePlanId() {
		return this._state.subscription?.plan.effective.id ?? SubscriptionPlanId.Pro;
	}

	private get planName() {
		return getSubscriptionStateName(this.subscriptionState, this.planId, this.effectivePlanId);
	}

	private get planTier() {
		if (isSubscriptionTrial(this.subscription)) {
			return 'Pro Trial';
		}

		return getSubscriptionPlanTier(this.planId);
	}

	@consume({ context: promosContext })
	private promos!: PromosContext;

	private get subscription() {
		return this._state.subscription;
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
		return html`<gl-popover placement="bottom" trigger="hover focus click" hoist>
				<span id="chip" slot="anchor" class="chip" tabindex="0">
					${this.accountAvatar
						? html`<img class="chip__media" src=${this.accountAvatar} />`
						: html`<code-icon class="chip__media" icon="gl-gitlens" size="16"></code-icon>`}
					<span>${this.planTier}</span>
				</span>
				<div slot="content" class="content" tabindex="-1">
					<div class="header">
						<span class="header__title">${this.planName}</span>
						<span class="header__actions">
							${this.hasAccount
								? html`<gl-button
											appearance="toolbar"
											href="${createCommandLink<Source>('gitlens.views.home.account.resync', {
												source: 'account',
											})}"
											tooltip="Synchronize Status"
											aria-label="Synchronize Status"
											><code-icon icon="sync"></code-icon
										></gl-button>
										<gl-button
											appearance="toolbar"
											href="${createCommandLink<Source>('gitlens.plus.manage', {
												source: 'account',
											})}"
											tooltip="Manage Account"
											aria-label="Manage Account"
											><code-icon icon="gear"></code-icon
										></gl-button>
										<gl-button
											appearance="toolbar"
											href="${createCommandLink<Source>('gitlens.plus.logout', {
												source: 'account',
											})}"
											tooltip="Sign Out"
											aria-label="Sign Out"
											><code-icon icon="sign-out"></code-icon
										></gl-button>`
								: nothing}
						</span>
					</div>
					${this.renderAccountInfo()} ${this.renderAccountState()}
				</div>
			</gl-popover>
			${this.renderUpgradeContent()}`;
	}

	show(): void {
		void this._popover.show();
		this.focus();
	}

	private renderAccountInfo() {
		const organization = this._state.subscription?.activeOrganization?.name ?? '';
		if (!this.hasAccount || !organization) return nothing;

		return html`<div class="account-info">
			<span class="row">
				<span class="row__media"
					>${this._state.avatar
						? html`<img src=${this._state.avatar} />`
						: html`<code-icon icon="gl-gitlens" size="20"></code-icon>`}</span
				>
				<span class="details"
					><p class="details__title">${this.accountName}</p>
					<p class="details__subtitle">${this.accountEmail}</p></span
				>
			</span>
			<span class="row">
				<span class="row__media"><code-icon icon="organization" size="20"></code-icon></span>
				<span class="details"><p class="details__title">${organization}</p></span>
				${when(
					this._state.organizationsCount! > 1,
					() =>
						html`<div class="details__button">
							<gl-button
								appearance="toolbar"
								href="${createCommandLink<Source>('gitlens.gk.switchOrganization', {
									source: 'account',
									detail: {
										organization: this._state.subscription?.activeOrganization?.id,
									},
								})}"
								aria-label="Switch Active Organization"
								><span class="org__badge">+${this._state.organizationsCount! - 1}</span
								><code-icon icon="arrow-swap"></code-icon
								><span slot="tooltip"
									>Switch Active Organization
									<hr />
									You are in
									${pluralize('organization', this._state.organizationsCount! - 1, {
										infix: ' other ',
									})}</span
								></gl-button
							>
						</div>`,
				)}
			</span>
			${when(
				isSubscriptionStatePaidOrTrial(this.subscription.state),
				() =>
					html`<span class="row">
						<span class="row__media"><code-icon icon="unlock" size="20"></code-icon></span>
						<span class="details"
							><p class="details__title">
								${isSubscriptionTrial(this.subscription)
									? html`${getSubscriptionPlanTier(this.effectivePlanId)} plan
											<span class="details__subtitle">(trial)</span>`
									: html`${getSubscriptionPlanTier(this.planId)} plan`}
							</p></span
						>
						${isSubscriptionPaid(this.subscription) &&
						compareSubscriptionPlans(this.planId, SubscriptionPlanId.Advanced) < 0
							? html`<div class="details__button">
									<gl-button
										appearance="secondary"
										href="${createCommandLink<SubscriptionUpgradeCommandArgs>(
											'gitlens.plus.upgrade',
											{
												plan: SubscriptionPlanId.Advanced,
												source: 'account',
												detail: {
													location: 'plan-section:upgrade-button',
													organization: this._state.subscription?.activeOrganization?.id,
													plan: SubscriptionPlanId.Advanced,
												},
											},
										)}"
										aria-label="Ugrade to Advanced"
										><span class="upgrade-button">Upgrade</span
										><span slot="tooltip"
											>Ugrade to the Advanced plan for access to self-hosted integrations,
											advanced AI features @ 500K tokens/week, and more</span
										>
									</gl-button>
							  </div>`
							: nothing}
					</span>`,
			)}
		</div>`;
	}

	private renderAccountState() {
		switch (this.subscriptionState) {
			case SubscriptionState.Paid:
				return html`<div class="account-status">
					${this.renderIncludesDevEx()}${this.renderReferFriend()}
				</div> `;

			case SubscriptionState.VerificationRequired:
				return html`<div class="account-status">
					<p>You must verify your email before you can access Pro features.</p>
					<button-container>
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

			case SubscriptionState.ProTrial: {
				const days = this.trialDaysRemaining;

				return html`<div class="account-status">
					${this.isReactivatedTrial
						? html`<p>
								<code-icon icon="megaphone"></code-icon>
								See
								<a href="${urls.releaseNotes}">what's new</a>
								in GitLens.
						  </p>`
						: nothing}
					<p>
						You have
						<strong>${days < 1 ? '<1 day' : pluralize('day', days, { infix: ' more ' })} left</strong>
						in your Pro trial. Once your trial ends, you will only be able to use Pro features on
						publicly-hosted repos.
					</p>
					<button-container>
						<gl-button
							full
							href="${createCommandLink<SubscriptionUpgradeCommandArgs>('gitlens.plus.upgrade', {
								plan: SubscriptionPlanId.Pro,
								source: 'account',
								detail: {
									location: 'upgrade-button',
									organization: this._state.subscription?.activeOrganization?.id,
									plan: SubscriptionPlanId.Pro,
								},
							})}"
							>Upgrade to Pro</gl-button
						>
					</button-container>
					${this.renderPromo()} ${this.renderIncludesDevEx()} ${this.renderReferFriend()}
				</div>`;
			}

			case SubscriptionState.ProTrialExpired:
				return html`<div class="account-status">
					<p>Thank you for trying <a href="${urls.communityVsPro}">GitLens Pro</a>.</p>
					<p>Continue leveraging Pro features and workflows on privately-hosted repos by upgrading today.</p>
					<button-container>
						<gl-button
							full
							href="${createCommandLink<SubscriptionUpgradeCommandArgs>('gitlens.plus.upgrade', {
								plan: SubscriptionPlanId.Pro,
								source: 'account',
								detail: {
									location: 'upgrade-button',
									organization: this._state.subscription?.activeOrganization?.id,
									plan: SubscriptionPlanId.Pro,
								},
							})}"
							>Upgrade to Pro</gl-button
						>
					</button-container>
					${this.renderPromo()} ${this.renderIncludesDevEx()} ${this.renderReferFriend()}
				</div>`;

			case SubscriptionState.ProTrialReactivationEligible:
				return html`<div class="account-status">
					<p>
						Reactivate your GitLens Pro trial and experience all the new Pro features — free for another
						${pluralize('day', proTrialLengthInDays)}.
					</p>
					<button-container>
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
						Unlock advanced features and workflows on private repos, accelerate reviews, and streamline
						collaboration with
						<a href="${urls.communityVsPro}">GitLens Pro</a>.
					</p>
					<button-container>
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

	private renderIncludesDevEx() {
		return html`<p>Includes access to <a href="${urls.platform}">GitKraken's DevEx platform</a></p>`;
	}

	private renderReferFriend() {
		if (!isSubscriptionPaid(this.subscription)) return nothing;

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
		if (isSubscriptionPaid(this.subscription)) {
			this.showUpgrade = false;
			return nothing;
		}

		this.showUpgrade = true;

		return html`<gl-popover placement="bottom" trigger="hover focus click" hoist>
			<span slot="anchor" class="chip chip--outlined" tabindex="0">
				<span>Upgrade</span>
			</span>
			<div slot="content" class="content" tabindex="-1">
				<div class="header">
					<span class="header__title">Advantages of GitLens Pro</span>
				</div>
				<div class="upgrade">
					<button-container>
						<gl-button
							full
							href="${createCommandLink<SubscriptionUpgradeCommandArgs>('gitlens.plus.upgrade', {
								plan: SubscriptionPlanId.Pro,
								source: 'account',
								detail: {
									location: 'upgrade-chip:upgrade-button',
									organization: this._state.subscription?.activeOrganization?.id,
									plan: SubscriptionPlanId.Pro,
								},
							})}"
							>Upgrade to Pro</gl-button
						>
					</button-container>
					${this.renderPromo()}

					<ul>
						<li>Unlimited cloud integrations</li>
						<li>Smart AI features &mdash; 250K tokens/week</li>
						<li>
							Powerful tools &mdash; Commit Graph, Visual History, &amp; Git Worktrees on private repos
						</li>
						<li>Streamlined workflows &mdash; start work from issues, pull request reviews</li>
					</ul>

					<br />
					<button-container>
						<gl-button
							full
							href="${createCommandLink<SubscriptionUpgradeCommandArgs>('gitlens.plus.upgrade', {
								plan: SubscriptionPlanId.Advanced,
								source: 'account',
								detail: {
									location: 'upgrade-chip:upgrade-button',
									organization: this._state.subscription?.activeOrganization?.id,
									plan: SubscriptionPlanId.Advanced,
								},
							})}"
							>Upgrade to Advanced</gl-button
						>
					</button-container>
					<ul>
						<li>Self-hosted integrations</li>
						<li>Advanced AI features &mdash; 500K tokens/week</li>
					</ul>
				</div>
			</div>
		</gl-popover>`;
	}

	private renderPromo() {
		return html`<gl-promo
			.promoPromise=${this.promos.getApplicablePromo('account')}
			.source="${{ source: 'account' } as const}"
		></gl-promo>`;
	}
}
