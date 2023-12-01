import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import { hasAccountFromSubscriptionState, SubscriptionState } from '../../../../../plus/gk/account/subscription';
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

			.account__media {
				grid-column: 1;
				grid-row: 1 / span 3;
				display: flex;
				align-items: center;
			}

			.account__image {
				width: 100%;
				aspect-ratio: 1 / 1;
				border-radius: 50%;
			}

			.account__title {
				font-size: var(--vscode-font-size);
				font-weight: 600;
				margin: 0;
			}

			.account__organization {
				position: relative;
				margin: 0.2rem 0 0.2rem 0;
				color: var(--color-foreground--65);
			}

			.account__organization__icon {
				margin-right: 0.1rem;
			}

			.account__access {
				position: relative;
				margin: 0;
				color: var(--color-foreground--65);
			}

			.account__signout {
				grid-row: 1 / span 2;
			}

			.repo-access {
				font-size: 1.1em;
				margin-right: 0.2rem;
			}
			.repo-access:not(.is-pro) {
				filter: grayscale(1) brightness(0.7);
			}
		`,
	];

	@property()
	image = '';

	@property()
	name = '';

	@property()
	organization = '';

	@property()
	hasMultipleOrganizations = false;

	@property({ type: Number })
	days = 0;

	@property({ type: Number })
	state: SubscriptionState = SubscriptionState.Free;

	@property()
	plan = '';

	@property({ type: Number })
	trialReactivationCount = 0;

	get daysRemaining() {
		if (this.days < 1) {
			return '<1 day';
		}
		return pluralize('day', this.days);
	}

	get planName() {
		switch (this.state) {
			case SubscriptionState.Free:
			case SubscriptionState.FreePreviewTrialExpired:
			case SubscriptionState.FreePlusTrialExpired:
				return 'GitKraken Free';
			case SubscriptionState.FreeInPreviewTrial:
			case SubscriptionState.FreePlusInTrial:
				return 'GitKraken Pro (Trial)';
			case SubscriptionState.VerificationRequired:
				return `${this.plan} (Unverified)`;
			default:
				return this.plan;
		}
	}

	get daysLeft() {
		switch (this.state) {
			case SubscriptionState.FreeInPreviewTrial:
			case SubscriptionState.FreePlusInTrial:
				return `, ${this.daysRemaining} left`;
			default:
				return '';
		}
	}

	get hasAccount() {
		return hasAccountFromSubscriptionState(this.state);
	}

	get isReactivatedTrial() {
		return this.state === SubscriptionState.FreePlusInTrial && this.trialReactivationCount > 0;
	}

	private renderAccountInfo() {
		if (!this.hasAccount) {
			return nothing;
		}

		return html`
			<div class="account">
				<div class="account__media">
					${this.image
						? html`<img src=${this.image} class="account__image" />`
						: html`<code-icon icon="account" size="34"></code-icon>`}
				</div>
				<p class="account__title">${this.name}</p>
				${this.organization
					? html` <p class="account__organization">
							<span class="account__organization__icon"
								><code-icon
									icon="organization"
									title="Organization"
									aria-label="Organization"
								></code-icon
							></span>
							<span>${this.organization}</span>
							${this.hasMultipleOrganizations
								? html`
										<span>
											<a
												href="command:gitlens.gk.switchOrganization"
												title="Switch Organization"
												aria-label="Switch Organization"
												><code-icon
													icon="chevron-down"
													title="Switch Organization..."
													aria-label="Switch Organization"
												></code-icon
											></a>
										</span>
								  `
								: null}
					  </p>`
					: null}
				<p class="account__access">${this.planName}${this.daysLeft}</p>
				<div class="account__signout">
					<gl-button appearance="toolbar" href="command:gitlens.plus.logout"
						><code-icon icon="sign-out" title="Sign Out" aria-label="Sign Out"></code-icon
					></gl-button>
				</div>
			</div>
		`;
	}

	private renderAccountState() {
		const inCyberPromo = Date.now() < new Date('2023-12-06T07:59:00.000Z').getTime();

		switch (this.state) {
			case SubscriptionState.VerificationRequired:
				return html`
					<p>You must verify your email before you can continue.</p>
					<button-container>
						<gl-button full href="command:gitlens.plus.resendVerification"
							>Resend verification email</gl-button
						>
					</button-container>
					<button-container>
						<gl-button full href="command:gitlens.plus.validate">Refresh verification status</gl-button>
					</button-container>
				`;

			case SubscriptionState.Free:
			case SubscriptionState.FreeInPreviewTrial:
			case SubscriptionState.FreePreviewTrialExpired:
				return html`
					<p>
						Sign up for access to our developer productivity and collaboration services, e.g. Workspaces, or
						<a href="command:gitlens.plus.loginOrSignUp">sign in</a>.
					</p>
					<button-container>
						<gl-button full href="command:gitlens.plus.loginOrSignUp">Sign Up</gl-button>
					</button-container>
					<p>Signing up starts a free 7-day GitKraken trial.</p>
				`;

			case SubscriptionState.FreePlusTrialExpired:
				return html`
					<p>
						Your GitKraken trial has ended, please upgrade to continue to use ✨ features on privately
						hosted repos.
					</p>
					${when(
						inCyberPromo,
						() =>
							html`<p style="text-align: center;">
								<a
									href=${'https://www.gitkraken.com/cw23?utm_source=cyber_week&utm_medium=gitlens_banner&utm_campaign=cyber_week_2023'}
									>Cyber Week Sale: 50% off first seat of Pro — only $4/month! Includes entire
									GitKraken suite of dev tools.</a
								>
							</p>`,
						() =>
							html`<p style="text-align: center;">
								Special: 50% off first seat of Pro — only $4/month! Includes entire GitKraken suite of
								dev tools.
							</p>`,
					)}
					<button-container>
						<gl-button full href="command:gitlens.plus.purchase">Upgrade to Pro</gl-button>
					</button-container>
					<p>
						You only have access to ✨ features on local and publicly hosted repos and ☁️ features based on
						your plan, e.g. Free, Pro, etc.
					</p>
				`;

			case SubscriptionState.FreePlusInTrial:
				return html`
					<p>
						${this.isReactivatedTrial
							? html`<a href="https://help.gitkraken.com/gitlens/gitlens-release-notes-current/"
										>See what's new</a
									>
									with
									${pluralize('day', this.days, {
										infix: ' more ',
									})}
									in your GitKraken trial.`
							: `You have
						${this.daysRemaining} remaining in your GitKraken trial.`}
						Once your trial ends, you'll need a paid plan to continue using ✨ features.
					</p>
					${when(
						inCyberPromo,
						() =>
							html`<p style="text-align: center;">
								<a
									href=${'https://www.gitkraken.com/cw23?utm_source=cyber_week&utm_medium=gitlens_banner&utm_campaign=cyber_week_2023'}
									>Cyber Week Sale: <b>50% off first seat of Pro</b> — only $4/month! Includes entire
									GitKraken suite of dev tools.</a
								>
							</p>`,
						() =>
							html`<p style="text-align: center;">
								Special: <b>50% off first seat of Pro</b> — only $4/month! Includes entire GitKraken
								suite of dev tools.
							</p>`,
					)}
					<button-container>
						<gl-button full href="command:gitlens.plus.purchase">Upgrade to Pro</gl-button>
					</button-container>
					<p>
						You have access to ✨ features on privately hosted repos and ☁️ features based on the Pro plan.
					</p>
					<p>
						Try our
						<a href="https://www.gitkraken.com/suite">other developer tools</a> also included in your trial.
					</p>
				`;

			case SubscriptionState.Paid:
				return html`
					<button-container>
						<gl-button appearance="secondary" full href="command:gitlens.plus.manage"
							>Manage Account</gl-button
						>
					</button-container>
					<p>You have access to ✨ features on privately hosted repos and ☁️ features based on your plan.</p>
					<p>
						Try our
						<a href="https://www.gitkraken.com/suite">other developer tools</a> also included in your plan.
					</p>
				`;
		}

		return nothing;
	}

	override render() {
		return html`${this.renderAccountInfo()}${this.renderAccountState()}`;
	}
}
