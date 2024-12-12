import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import { urls } from '../../../../../constants';
import { proTrialLengthInDays, SubscriptionPlanId, SubscriptionState } from '../../../../../constants.subscription';
import type { Source } from '../../../../../constants.telemetry';
import type { Promo } from '../../../../../plus/gk/account/promos';
import { getApplicablePromo } from '../../../../../plus/gk/account/promos';
import {
	getSubscriptionPlanTier,
	getSubscriptionStateName,
	getSubscriptionTimeRemaining,
	hasAccountFromSubscriptionState,
} from '../../../../../plus/gk/account/subscription';
import { createCommandLink } from '../../../../../system/commands';
import { pluralize } from '../../../../../system/string';
import type { State } from '../../../../home/protocol';
import { stateContext } from '../../../home/context';
import type { GlPopover } from '../../../shared/components/overlays/popover.react';
import { elementBase, linkBase } from '../../../shared/components/styles/lit/base.css';
import { chipStyles } from './chipStyles';
import '../../../shared/components/button';
import '../../../shared/components/button-container';
import '../../../shared/components/code-icon';
import '../../../shared/components/overlays/popover';

@customElement('gl-account-chip')
export class GLAccountChip extends LitElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = [
		elementBase,
		linkBase,
		chipStyles,
		css`
			.chip {
				padding-right: 0.6rem;

				font-size: 1.1rem;
				font-weight: 400;
				text-transform: uppercase;
			}

			:host-context(.vscode-dark) .chip,
			:host-context(.vscode-high-contrast) .chip {
				background-color: color-mix(in lab, var(--vscode-sideBar-background), #fff 10%);
			}

			:host-context(.vscode-light) .chip,
			:host-context(.vscode-high-contrast-light) .chip {
				background-color: color-mix(in lab, var(--vscode-sideBar-background), #000 7%);
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
			}

			:host-context(.vscode-dark) img.chip__media,
			:host-context(.vscode-high-contrast) img.chip__media {
				background-color: color-mix(in lab, var(--vscode-sideBar-background), #fff 25%);
			}

			:host-context(.vscode-light) img.chip__media,
			:host-context(.vscode-high-contrast-light) img.chip__media {
				background-color: color-mix(in lab, var(--vscode-sideBar-background), #000 18%);
			}

			.account-org {
				display: flex;
				flex-direction: column;
				gap: 0.2rem;
			}

			.account {
				position: relative;
				display: flex;
				flex-direction: row;
				gap: 0 0.6rem;
				align-items: center;
			}

			.account__media {
				flex: 0 0 auto;
				width: 3.4rem;
				display: flex;
				align-items: center;
				justify-content: center;
			}

			img.account__media {
				width: 2rem;
				aspect-ratio: 1 / 1;
				border-radius: 50%;
			}

			:host-context(.vscode-dark) img.account__media,
			:host-context(.vscode-high-contrast) img.account__media {
				background-color: color-mix(in lab, var(--vscode-sideBar-background), #fff 20%);
			}

			:host-context(.vscode-light) img.account__media,
			:host-context(.vscode-high-contrast-light) img.account__media {
				background-color: color-mix(in lab, var(--vscode-sideBar-background), #000 15%);
			}

			.account__details {
				display: flex;
				flex-direction: column;
				justify-content: center;
			}

			.account__title {
				font-size: 1.3rem;
				font-weight: 600;
				margin: 0;
			}

			.account__email {
				font-size: 1.1rem;
				font-weight: 400;
				margin: 0;
				color: var(--color-foreground--65);
			}

			.org {
				position: relative;
				display: flex;
				flex-direction: row;
				gap: 0 0.6rem;
				align-items: center;
				margin-bottom: 0.6rem;
			}

			.org__media {
				flex: none;
				width: 3.4rem;
				display: flex;
				align-items: center;
				justify-content: center;
				color: var(--color-foreground--65);
			}

			.org__details {
				flex: 1;
				display: flex;
				flex-direction: column;
				justify-content: center;
			}

			.org__title {
				font-size: 1.3rem;
				font-weight: 600;
				margin: 0;
			}

			.org__access {
				position: relative;
				margin: 0;
				color: var(--color-foreground--65);
			}

			.org__signout {
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
		`,
	];

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

	get isReactivatedTrial() {
		return (
			this.subscriptionState === SubscriptionState.ProTrial &&
			(this.subscription?.plan.effective.trialReactivationCount ?? 0) > 0
		);
	}
	private get planId() {
		return this._state.subscription?.plan.actual.id ?? SubscriptionPlanId.Pro;
	}

	private get planName() {
		return getSubscriptionStateName(this.subscriptionState, this.planId);
	}

	private get planTier() {
		return getSubscriptionPlanTier(this.planId);
	}

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

	override focus() {
		this._chip.focus();
	}

	override render() {
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
							: html`<gl-button
									appearance="toolbar"
									href="${createCommandLink<Source>('gitlens.plus.login', {
										source: 'account',
									})}"
									tooltip="Sign In"
									aria-label="Sign In"
									><code-icon icon="sign-in"></code-icon
							  ></gl-button>`}
					</span>
				</div>
				${this.renderOrganization()} ${this.renderAccountState()}
			</div>
		</gl-popover>`;
	}

	show() {
		void this._popover.show();
		this.focus();
	}

	private renderOrganization() {
		const organization = this._state.subscription?.activeOrganization?.name ?? '';
		if (!this.hasAccount || !organization) return nothing;

		return html`<div class="account-org">
			<span class="account">
				<span class="account__media"
					>${this._state.avatar
						? html`<img class="account__media" src=${this._state.avatar} />`
						: html`<code-icon class="account__media" icon="gl-gitlens" size="20"></code-icon>`}</span
				>
				<span class="account__details"
					><p class="account__title">${this.accountName}</p>
					<p class="account__email">${this.accountEmail}</p></span
				>
			</span>
			<span class="org">
				<span class="org__media"><code-icon icon="organization" size="20"></code-icon></span>
				<span class="org__details"><p class="org__title">${organization}</p></span>
				${when(
					this._state.organizationsCount! > 1,
					() =>
						html`<div class="org__signout">
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
		</div>`;
	}

	private renderAccountState() {
		const promo = getApplicablePromo(this.subscriptionState, 'account');

		switch (this.subscriptionState) {
			case SubscriptionState.Paid:
				return html`<div class="account-status">${this.renderIncludesDevEx()}</div> `;

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
							href="${createCommandLink<Source>('gitlens.plus.upgrade', {
								source: 'account',
							})}"
							>Upgrade to Pro</gl-button
						>
					</button-container>
					${this.renderPromo(promo)} ${this.renderIncludesDevEx()}
				</div>`;
			}

			case SubscriptionState.ProTrialExpired:
				return html`<div class="account-status">
					<p>Thank you for trying <a href="${urls.communityVsPro}">GitLens Pro</a>.</p>
					<p>Continue leveraging Pro features and workflows on privately-hosted repos by upgrading today.</p>
					<button-container>
						<gl-button
							full
							href="${createCommandLink<Source>('gitlens.plus.upgrade', {
								source: 'account',
							})}"
							>Upgrade to Pro</gl-button
						>
					</button-container>
					${this.renderPromo(promo)} ${this.renderIncludesDevEx()}
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

	private renderPromo(promo: Promo | undefined) {
		return html`<gl-promo .promo=${promo}></gl-promo>`;
	}
}
