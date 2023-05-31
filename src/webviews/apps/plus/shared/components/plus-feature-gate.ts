import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { SubscriptionState } from '../../../../../subscription';
import '../../../shared/components/button';
import { linkStyles } from './vscode.css';

@customElement('plus-feature-gate')
export class PlusFeatureGate extends LitElement {
	static override styles = [
		linkStyles,
		css`
			:host {
				container-type: inline-size;
			}

			gk-button {
				width: 100%;
				max-width: 300px;
			}

			@container (max-width: 640px) {
				gk-button {
					display: block;
					margin-left: auto;
					margin-right: auto;
				}
			}
		`,
	];

	@property({ type: String })
	appearance?: 'alert' | 'welcome';

	@property({ type: Number })
	state?: SubscriptionState;

	override render() {
		const appearance = (this.appearance ?? 'alert') === 'alert' ? 'alert' : nothing;

		switch (this.state) {
			case SubscriptionState.VerificationRequired:
				return html`
					<p>You must verify your email before you can continue.</p>
					<gk-button appearance="${appearance}" href="command:gitlens.plus.resendVerification"
						>Resend verification email</gk-button
					>
					<gk-button appearance="${appearance}" href="command:gitlens.plus.validate"
						>Refresh verification status</gk-button
					>
				`;

			case SubscriptionState.Free:
				return html`
					<gk-button appearance="${appearance}" href="command:gitlens.plus.startPreviewTrial"
						>Start Free Pro Trial</gk-button
					>
					<p>
						Instantly start a free 3-day Pro trial, or
						<a href="command:gitlens.plus.loginOrSignUp">sign in</a>.
					</p>
					<p>✨ A trial or subscription is required to use this on privately hosted repos.</p>
				`;

			case SubscriptionState.FreePreviewTrialExpired:
				return html`
					<p>
						Your free 3-day Pro trial has ended, extend your free trial to get an additional 7-days, or
						<a href="command:gitlens.plus.loginOrSignUp">sign in</a>.
					</p>
					<gk-button appearance="${appearance}" href="command:gitlens.plus.loginOrSignUp"
						>Extend Free Pro Trial</gk-button
					>
					<p>✨ A trial or subscription is required to use this on privately hosted repos.</p>
				`;

			case SubscriptionState.FreePlusTrialExpired:
				return html`
					<p>Your Pro trial has ended, please upgrade to continue to use this on privately hosted repos.</p>
					<gk-button appearance="${appearance}" href="command:gitlens.plus.purchase"
						>Upgrade to Pro</gk-button
					>
					<p>✨ A subscription is required to use this on privately hosted repos.</p>
				`;
		}

		return undefined;
	}
}
