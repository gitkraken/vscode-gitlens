import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { hasAccountFromSubscriptionState, SubscriptionState } from '../../../../../subscription';
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
				grid-row: 1 / span 2;
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

	@property({ type: Number })
	days = 0;

	@property({ type: Number })
	state: SubscriptionState = SubscriptionState.Free;

	@property()
	plan = '';

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
				return 'GitLens Free';
			case SubscriptionState.FreeInPreviewTrial:
			case SubscriptionState.FreePlusInTrial:
				return 'GitLens Pro (Trial)';
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
				<p class="account__access">${this.planName}${this.daysLeft}</p>
				<div class="account__signout">
					<gk-button appearance="toolbar" href="command:gitlens.plus.logout"
						><code-icon icon="sign-out" title="Sign Out" aria-label="Sign Out"></code-icon
					></gk-button>
				</div>
			</div>
		`;
	}

	private renderAccountState() {
		switch (this.state) {
			case SubscriptionState.VerificationRequired:
				return html`
					<p>You must verify your email before you can continue.</p>
					<button-container>
						<gk-button full href="command:gitlens.plus.resendVerification"
							>Resend verification email</gk-button
						>
					</button-container>
					<button-container>
						<gk-button full href="command:gitlens.plus.validate">Refresh verification status</gk-button>
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
						<gk-button full href="command:gitlens.plus.loginOrSignUp">Sign Up</gk-button>
					</button-container>
					<p>Signing up starts a free 7-day Pro trial.</p>
				`;

			case SubscriptionState.FreePlusTrialExpired:
				return html`
					<p>
						Your Pro trial has ended, please upgrade to continue to use ✨ features on privately hosted
						repos.
					</p>
					<button-container>
						<gk-button full href="command:gitlens.plus.purchase">Upgrade to Pro</gk-button>
					</button-container>
					<p>
						You only have access to ✨ features on local and publicly hosted repos and ☁️ features based on
						your plan, e.g. Free, Pro, etc.
					</p>
				`;

			case SubscriptionState.FreePlusInTrial:
				return html`
					<p>
						Your have ${this.daysRemaining} remaining in your Pro trial. Once your trial ends, you'll need a
						paid plan to continue using ✨ features.
					</p>
					<button-container>
						<gk-button full href="command:gitlens.plus.purchase">Upgrade to Pro</gk-button>
					</button-container>
					<p>
						You have access to ✨ features on privately hosted repos and ☁️ features based on the Pro plan
						during your trial.
					</p>
				`;

			case SubscriptionState.Paid:
				return html`
					<button-container>
						<gk-button appearance="secondary" full href="command:gitlens.plus.manage"
							>Manage Account</gk-button
						>
					</button-container>
					<p>You have access to ✨ features on privately hosted repos and ☁️ features based on your plan.</p>
				`;
		}

		return nothing;
	}

	override render() {
		return html`${this.renderAccountInfo()}${this.renderAccountState()}`;
	}
}
