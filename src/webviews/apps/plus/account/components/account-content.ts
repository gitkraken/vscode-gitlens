import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import { urls } from '../../../../../constants';
import type { Subscription } from '../../../../../plus/gk/account/subscription';
import {
	getSubscriptionPlanName,
	getSubscriptionTimeRemaining,
	hasAccountFromSubscriptionState,
	SubscriptionPlanId,
	SubscriptionState,
} from '../../../../../plus/gk/account/subscription';
import { pluralize } from '../../../../../system/string';
import { elementBase, linkBase } from '../../../shared/components/styles/lit/base.css';
import '../../../shared/components/button';
import '../../../shared/components/button-container';
import '../../../shared/components/code-icon';

@customElement('account-content')
export class AccountContent extends LitElement {
	static override styles = [
		elementBase,
		linkBase,
		css`
			:host {
				display: block;
				margin-bottom: 1.3rem;
			}

			button-container {
				margin-bottom: 1.3rem;
			}

			.account {
				position: relative;
				display: grid;
				gap: 0 0.8rem;
				grid-template-columns: 3.4rem auto min-content;
				grid-auto-flow: column;
				margin-bottom: 1.3rem;
			}

			.account--org {
				font-size: 0.9em;
				line-height: 1.2;
				margin-top: -1rem;
			}

			.account__media {
				grid-column: 1;
				grid-row: 1 / span 2;
				display: flex;
				align-items: center;
				justify-content: center;
			}

			.account--org .account__media {
				color: var(--color-foreground--65);
			}

			.account__image {
				width: 100%;
				aspect-ratio: 1 / 1;
				border-radius: 50%;
			}

			.account__details {
				grid-row: 1 / span 2;
				display: flex;
				flex-direction: column;
				justify-content: center;
			}

			.account__title {
				font-size: 1.5rem;
				font-weight: 600;
				margin: 0;
			}

			.account--org .account__title {
				font-size: 1.2rem;
				font-weight: normal;
			}

			.account__access {
				position: relative;
				margin: 0;
				color: var(--color-foreground--65);
			}

			.account__signout {
				grid-row: 1 / span 2;
				display: flex;
				gap: 0.2rem;
				flex-direction: row;
				align-items: center;
				justify-content: center;
			}

			.account__badge {
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
			}

			.repo-access {
				font-size: 1.1em;
				margin-right: 0.2rem;
			}
			.repo-access:not(.is-pro) {
				filter: grayscale(1) brightness(0.7);
			}

			.special {
				font-size: smaller;
				margin-top: 0.8rem;
				opacity: 0.6;
				text-align: center;
			}
		`,
	];

	@property()
	image = '';

	@property({ type: Number })
	organizationsCount = 0;

	@property({ attribute: false })
	subscription?: Subscription;

	private get daysRemaining() {
		if (this.subscription == null) return 0;

		return getSubscriptionTimeRemaining(this.subscription, 'days') ?? 0;
	}

	get hasAccount() {
		return hasAccountFromSubscriptionState(this.state);
	}

	get isReactivatedTrial() {
		return (
			this.state === SubscriptionState.FreePlusInTrial &&
			(this.subscription?.plan.effective.trialReactivationCount ?? 0) > 0
		);
	}

	private get planId() {
		return this.subscription?.plan.actual.id ?? SubscriptionPlanId.Pro;
	}

	get planName() {
		switch (this.state) {
			case SubscriptionState.Free:
			case SubscriptionState.FreePreviewTrialExpired:
			case SubscriptionState.FreePlusTrialExpired:
			case SubscriptionState.FreePlusTrialReactivationEligible:
				return 'GitKraken Free';
			case SubscriptionState.FreeInPreviewTrial:
			case SubscriptionState.FreePlusInTrial:
				return 'GitKraken Pro (Trial)';
			case SubscriptionState.VerificationRequired:
				return `${getSubscriptionPlanName(this.planId)} (Unverified)`;
			default:
				return getSubscriptionPlanName(this.planId);
		}
	}

	private get state() {
		return this.subscription?.state;
	}

	override render() {
		return html`${this.renderAccountInfo()}${this.renderOrganization()}${this.renderAccountState()}`;
	}

	private renderAccountInfo() {
		if (!this.hasAccount) return nothing;

		return html`
			<div class="account">
				<div class="account__media">
					${this.image
						? html`<img src=${this.image} class="account__image" />`
						: html`<code-icon icon="account" size="34"></code-icon>`}
				</div>
				<div class="account__details">
					<p class="account__title">${this.subscription?.account?.name ?? ''}</p>
					${when(this.organizationsCount === 0, () => html`<p class="account__access">${this.planName}</p>`)}
				</div>
				<div class="account__signout">
					<gl-button
						appearance="toolbar"
						href="command:gitlens.plus.logout"
						tooltip="Sign Out"
						aria-label="Sign Out"
						><code-icon icon="sign-out"></code-icon
					></gl-button>
				</div>
			</div>
		`;
	}

	private renderOrganization() {
		const organization = this.subscription?.activeOrganization?.name ?? '';
		if (!this.hasAccount || !organization) return nothing;

		return html`
			<div class="account account--org">
				<div class="account__media">
					<code-icon icon="organization" size="22"></code-icon>
				</div>
				<div class="account__details">
					<p class="account__title">${organization}</p>
					<p class="account__access">${this.planName}</p>
				</div>
				${when(
					this.organizationsCount > 1,
					() =>
						html`<div class="account__signout">
							<span class="account__badge">+${this.organizationsCount - 1}</span>
							<gl-button
								appearance="toolbar"
								href="command:gitlens.gk.switchOrganization"
								tooltip="Switch Organization"
								aria-label="Switch Organization"
								><code-icon icon="arrow-swap"></code-icon
							></gl-button>
						</div>`,
				)}
			</div>
		`;
	}

	private renderAccountState() {
		switch (this.state) {
			case SubscriptionState.Paid:
				return html`
					<button-container>
						<gl-button appearance="secondary" full href="command:gitlens.plus.manage"
							>Manage Account</gl-button
						>
						<gl-button
							appearance="secondary"
							full
							href="command:gitlens.plus.cloudIntegrations.manage?%7B%22source%22%3A%22account%22%7D"
							>Cloud Integrations</gl-button
						>
					</button-container>
					<p>
						Your ${getSubscriptionPlanName(this.planId)} plan provides full access to all Pro features and
						our <a href="${urls.platform}">DevEx platform</a>, unleashing powerful Git visualization &
						productivity capabilities everywhere you work: IDE, desktop, browser, and terminal.
					</p>
				`;

			case SubscriptionState.VerificationRequired:
				return html`
					<p>You must verify your email before you can access Pro features.</p>
					<button-container>
						<gl-button full href="command:gitlens.plus.resendVerification">Resend Email</gl-button>
						<gl-button appearance="secondary" href="command:gitlens.plus.validate"
							><code-icon size="20" icon="refresh"></code-icon>
						</gl-button>
					</button-container>
				`;

			case SubscriptionState.FreePlusInTrial: {
				const days = this.daysRemaining;

				return html`
					${this.isReactivatedTrial
						? html`<p>
								<code-icon icon="rocket"></code-icon>
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
					<p class="special">Special: <b>50% off first seat of Pro</b> — only $4/month!</p>
					${this.renderIncludesDevEx()}
				`;
			}

			case SubscriptionState.FreePlusTrialExpired:
				return html`
					<p>Your Pro trial has ended. You can now only use Pro features on publicly-hosted repos.</p>
					<button-container>
						<gl-button full href="command:gitlens.plus.upgrade">Upgrade to Pro</gl-button>
					</button-container>
					<p class="special">Special: <b>50% off first seat of Pro</b> — only $4/month!</p>
					${this.renderIncludesDevEx()}
				`;

			case SubscriptionState.FreePlusTrialReactivationEligible:
				return html`
					<p>Reactivate your Pro trial and experience all the new Pro features — free for another 7 days!</p>
					<button-container>
						<gl-button full href="command:gitlens.plus.reactivateProTrial">Reactivate Pro Trial</gl-button>
					</button-container>
					${this.renderIncludesDevEx()}
				`;

			default:
				return html`
					<p>
						Sign up for access to Pro features and our
						<a href="${urls.platform}">DevEx platform</a>, or
						<a href="command:gitlens.plus.login">sign in</a>.
					</p>
					<button-container>
						<gl-button full href="command:gitlens.plus.signUp">Sign Up</gl-button>
					</button-container>
					<p>Signing up starts your free 7-day Pro trial.</p>
					${this.renderIncludesDevEx()}
				`;
		}
	}

	private renderIncludesDevEx() {
		return html`
			<p>
				Includes access to our
				<a href="${urls.platform}">DevEx platform</a>, unleashing powerful Git visualization & productivity
				capabilities everywhere you work: IDE, desktop, browser, and terminal.
			</p>
		`;
	}
}
