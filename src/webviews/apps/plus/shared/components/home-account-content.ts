import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import { urls } from '../../../../../constants';
import { proTrialLengthInDays, SubscriptionPlanId, SubscriptionState } from '../../../../../constants.subscription';
import type { Promo } from '../../../../../plus/gk/account/promos';
import { getApplicablePromo } from '../../../../../plus/gk/account/promos';
import {
	getSubscriptionPlanName,
	getSubscriptionStateName,
	getSubscriptionTimeRemaining,
	hasAccountFromSubscriptionState,
} from '../../../../../plus/gk/account/subscription';
import { pluralize } from '../../../../../system/string';
import type { State } from '../../../../home/protocol';
import { stateContext } from '../../../home/context';
import type { GlAccordion } from '../../../shared/components/accordion/accordion';
import { elementBase, linkBase } from '../../../shared/components/styles/lit/base.css';
import '../../../shared/components/accordion/accordion';
import '../../../shared/components/button';
import '../../../shared/components/button-container';
import '../../../shared/components/code-icon';
import '../../../shared/components/promo';

@customElement('gl-home-account-content')
export class GLHomeAccountContent extends LitElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = [
		elementBase,
		linkBase,
		css`
			:host {
				display: block;
				margin-bottom: 1.3rem;
			}

			:host > * {
				margin-bottom: 0;
			}

			button-container {
				margin-bottom: 1.3rem;
			}

			.header {
				display: flex;
				align-items: center;
				gap: 0.6rem;
			}

			.header__media {
				flex: none;
			}

			.header__actions {
				flex: none;
				display: flex;
				gap: 0.2rem;
				flex-direction: row;
				align-items: center;
				justify-content: center;
			}

			img.header__media {
				width: 3rem;
				aspect-ratio: 1 / 1;
				border-radius: 50%;
			}

			.header__title {
				flex: 1;
				font-size: 1.5rem;
				font-weight: 600;
				margin: 0;
			}

			.org {
				position: relative;
				display: flex;
				flex-direction: row;
				gap: 0 0.8rem;
				align-items: center;
				margin-bottom: 1.3rem;
			}

			.org__media {
				flex: none;
				width: 3.4rem;
				display: flex;
				align-items: center;
				justify-content: center;
				color: var(--color-foreground--65);
			}

			.org__image {
				width: 100%;
				aspect-ratio: 1 / 1;
				border-radius: 50%;
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

			.account > :first-child {
				margin-block-start: 0;
			}
			.account > :last-child {
				margin-block-end: 0;
			}

			hr {
				border: none;
				border-top: 1px solid var(--color-foreground--25);
			}
		`,
	];

	@query('#accordion')
	private accordionEl!: GlAccordion;

	@consume<State>({ context: stateContext, subscribe: true })
	@state()
	private _state!: State;

	private get daysRemaining() {
		if (this._state.subscription == null) return 0;

		return getSubscriptionTimeRemaining(this._state.subscription, 'days') ?? 0;
	}

	get hasAccount() {
		return hasAccountFromSubscriptionState(this.state);
	}

	get isReactivatedTrial() {
		return (
			this.state === SubscriptionState.ProTrial &&
			(this._state.subscription?.plan.effective.trialReactivationCount ?? 0) > 0
		);
	}

	private get planId() {
		return this._state.subscription?.plan.actual.id ?? SubscriptionPlanId.Pro;
	}

	get planName() {
		return getSubscriptionStateName(this.state, this.planId);
	}

	private get state() {
		return this._state.subscription?.state;
	}

	override render() {
		return html`<gl-accordion id="accordion">
			<div class="header" slot="header">
				${this.hasAccount && this._state.avatar
					? html`<img class="header__media" src=${this._state.avatar} />`
					: html`<code-icon class="header__media" icon="gl-gitlens" size="30"></code-icon>`}
				<span class="header__title">${this.planName}</span>
				${when(
					this.state === SubscriptionState.ProTrialReactivationEligible,
					() => html`
						<gl-button
							appearance="secondary"
							tight
							href="command:gitlens.plus.reactivateProTrial"
							tooltip="Reactivate your Pro trial for another ${pluralize('day', proTrialLengthInDays)}"
							>Reactivate Pro Trial</gl-button
						>
					`,
				)}
				${when(
					this.hasAccount,
					() => html`
						<span class="header__actions">
							<gl-button
								appearance="toolbar"
								href="command:gitlens.plus.logout"
								tooltip="Sign Out"
								aria-label="Sign Out"
								><code-icon icon="sign-out"></code-icon
							></gl-button>
						</span>
					`,
				)}
			</div>
			${this.renderOrganization()}${this.renderAccountState()}
			<slot></slot>
		</gl-accordion>`;
	}

	private renderOrganization() {
		const organization = this._state.subscription?.activeOrganization?.name ?? '';
		if (!this.hasAccount || !organization) return nothing;

		return html`
			<div class="org">
				<div class="org__media">
					<code-icon icon="organization" size="22"></code-icon>
				</div>
				<div class="org__details">
					<p class="org__title">${organization}</p>
				</div>
				${when(
					this._state.organizationsCount! > 1,
					() =>
						html`<div class="org__signout">
							<gl-button
								appearance="toolbar"
								href="command:gitlens.gk.switchOrganization"
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
			</div>
		`;
	}

	private renderAccountState() {
		const promo = getApplicablePromo(this.state);

		switch (this.state) {
			case SubscriptionState.Paid:
				return html`
					<div class="account">
						<button-container>
							<gl-button appearance="secondary" full href="command:gitlens.plus.manage"
								>Manage Account</gl-button
							>
							<gl-button
								appearance="secondary"
								full
								href="command:gitlens.plus.cloudIntegrations.manage?%7B%22source%22%3A%22account%22%7D"
								>Integrations</gl-button
							>
						</button-container>
						<p>
							Your ${getSubscriptionPlanName(this.planId)} plan provides full access to all Pro features
							and the <a href="${urls.platform}">GitKraken DevEx platform</a>, unleashing powerful Git
							visualization &amp; productivity capabilities everywhere you work: IDE, desktop, browser,
							and terminal.
						</p>
					</div>
				`;

			case SubscriptionState.VerificationRequired:
				return html`
					<div class="account">
						<p>You must verify your email before you can access Pro features.</p>
						<button-container>
							<gl-button full href="command:gitlens.plus.resendVerification">Resend Email</gl-button>
							<gl-button appearance="secondary" href="command:gitlens.plus.validate"
								><code-icon size="20" icon="refresh"></code-icon>
							</gl-button>
						</button-container>
					</div>
				`;

			case SubscriptionState.ProTrial: {
				const days = this.daysRemaining;

				return html`
					<div class="account">
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
							<gl-button full href="command:gitlens.plus.upgrade">Upgrade to Pro</gl-button>
						</button-container>
						${this.renderPromo(promo)} ${this.renderIncludesDevEx()}
					</div>
				`;
			}

			case SubscriptionState.ProTrialExpired:
				return html`
					<div class="account">
						<p>Your Pro trial has ended. You can now only use Pro features on publicly-hosted repos.</p>
						<button-container>
							<gl-button full href="command:gitlens.plus.upgrade">Upgrade to Pro</gl-button>
						</button-container>
						${this.renderPromo(promo)} ${this.renderIncludesDevEx()}
					</div>
				`;

			case SubscriptionState.ProTrialReactivationEligible:
				return html`
					<div class="account">
						<p>
							Reactivate your Pro trial and experience all the new Pro features — free for another
							${pluralize('day', proTrialLengthInDays)}!
						</p>
						<button-container>
							<gl-button
								full
								href="command:gitlens.plus.reactivateProTrial"
								tooltip="Reactivate your Pro trial for another ${pluralize(
									'day',
									proTrialLengthInDays,
								)}"
								>Reactivate Pro Trial</gl-button
							>
						</button-container>
						${this.renderIncludesDevEx()}
					</div>
				`;

			default:
				return html`
					<div class="account">
						<p>
							Sign up for access to Pro features and the
							<a href="${urls.platform}">GitKraken DevEx platform</a>, or
							<a href="command:gitlens.plus.login">sign in</a>.
						</p>
						<button-container>
							<gl-button full href="command:gitlens.plus.signUp">Sign Up</gl-button>
						</button-container>
						<p>Signing up starts your free ${proTrialLengthInDays}-day Pro trial.</p>
						${this.renderIncludesDevEx()}
					</div>
				`;
		}
	}

	private renderIncludesDevEx() {
		return html`
			<p>
				Includes access to the <a href="${urls.platform}">GitKraken DevEx platform</a>, unleashing powerful Git
				visualization &amp; productivity capabilities everywhere you work: IDE, desktop, browser, and terminal.
			</p>
		`;
	}

	private renderPromo(promo: Promo | undefined) {
		return html`<gl-promo .promo=${promo}></gl-promo>`;
	}

	override focus() {
		this.accordionEl.focus();
	}

	show() {
		this.accordionEl.open = true;
		this.accordionEl.focus();
	}
}
