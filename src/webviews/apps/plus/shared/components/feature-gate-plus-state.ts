import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { SubscriptionState } from '../../../../../subscription';
import '../../../shared/components/button';
import { linkStyles } from './vscode.css';

@customElement('gk-feature-gate-plus-state')
export class FeatureGatePlusState extends LitElement {
	static override styles = [
		linkStyles,
		css`
			:host {
				container-type: inline-size;
			}

			:host([appearance='welcome']) gl-button {
				width: 100%;
				max-width: 300px;
			}

			@container (max-width: 600px) {
				:host([appearance='welcome']) gl-button {
					display: block;
					margin-left: auto;
					margin-right: auto;
				}
			}

			:host([appearance='alert']) gl-button {
				display: block;
				margin-left: auto;
				margin-right: auto;
			}

			:host-context([appearance='alert']) p:first-child {
				margin-top: 0;
			}

			:host-context([appearance='alert']) p:last-child {
				margin-bottom: 0;
			}
		`,
	];

	@property({ type: String })
	appearance?: 'alert' | 'welcome';

	@property({ attribute: false, type: Number })
	state?: SubscriptionState;

	override render() {
		if (this.state == null) {
			this.hidden = true;
			return undefined;
		}

		this.hidden = false;
		const appearance = (this.appearance ?? 'alert') === 'alert' ? 'alert' : nothing;

		switch (this.state) {
			case SubscriptionState.VerificationRequired:
				return html`
					<p>You must verify your email before you can continue.</p>
					<gl-button appearance="${appearance}" href="command:gitlens.plus.resendVerification"
						>Resend verification email</gl-button
					>
					<gl-button appearance="${appearance}" href="command:gitlens.plus.validate"
						>Refresh verification status</gl-button
					>
				`;

			case SubscriptionState.Free:
				return html`
					<gl-button appearance="${appearance}" href="command:gitlens.plus.startPreviewTrial"
						>Preview Now</gl-button
					>
					<p>
						Preview Pro for 3 days, or
						<a href="command:gitlens.plus.loginOrSignUp">sign in</a> to start a full 7-day GitKraken trial.
					</p>
					<p>✨ A trial or paid plan is required to use this on privately hosted repos.</p>
				`;

			case SubscriptionState.FreePreviewTrialExpired:
				return html`
					<p>
						Your 3-day Pro preview has ended, start a free GitKraken trial to get an additional 7 days, or
						<a href="command:gitlens.plus.loginOrSignUp">sign in</a>.
					</p>
					<gl-button appearance="${appearance}" href="command:gitlens.plus.loginOrSignUp"
						>Start Free GitKraken Trial</gl-button
					>
					<p>✨ A trial or paid plan is required to use this on privately hosted repos.</p>
				`;

			case SubscriptionState.FreePlusTrialExpired:
				return html`
					<p>
						Your GitKraken trial has ended, please upgrade to continue to use this on privately hosted
						repos.
					</p>
					<gl-button appearance="${appearance}" href="command:gitlens.plus.purchase"
						>Upgrade to Pro</gl-button
					>
					<p>✨ A paid plan is required to use this on privately hosted repos.</p>
				`;
		}

		return undefined;
	}
}
