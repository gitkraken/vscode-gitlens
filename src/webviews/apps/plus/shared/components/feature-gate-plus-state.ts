import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import { SubscriptionState } from '../../../../../plus/gk/account/subscription';
import { linkStyles } from './vscode.css';
import '../../../shared/components/button';

@customElement('gl-feature-gate-plus-state')
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
		const expiresTime = new Date('2023-12-31T07:59:00.000Z').getTime(); // 2023-12-30 23:59:00 PST-0800
		const inHolidayPromo = Date.now() < expiresTime;

		switch (this.state) {
			case SubscriptionState.VerificationRequired:
				return html`
					<gl-button appearance="${appearance}" href="command:gitlens.plus.resendVerification"
						>Resend verification email</gl-button
					>
					<gl-button appearance="${appearance}" href="command:gitlens.plus.validate"
						>Refresh verification status</gl-button
					>
					<p>You must verify your email before you can continue.</p>
				`;

			case SubscriptionState.Free:
				return html`
					<gl-button appearance="${appearance}" href="command:gitlens.plus.startPreviewTrial"
						>Preview Pro</gl-button
					>
					<p>
						Preview local Pro features for 3 days, or
						<a href="command:gitlens.plus.signUp">sign up</a> to start a full 7-day GitLens Pro trial.
					</p>
					<p>A trial or paid plan is required to use this on privately hosted repos.</p>
				`;

			case SubscriptionState.FreePreviewTrialExpired:
				return html`
					<gl-button appearance="${appearance}" href="command:gitlens.plus.signUp">Start Pro Trial</gl-button>
					<p>
						Your 3-day preview has ended. Start a free GitLens Pro trial to get an additional 7 days, or
						<a href="command:gitlens.plus.login">sign in</a>.
					</p>
				`;

			case SubscriptionState.FreePlusTrialExpired:
				return html`
					<gl-button appearance="${appearance}" href="command:gitlens.plus.purchase"
						>Upgrade to Pro</gl-button
					>
					<p>
						Your GitLens Pro trial has ended. Please upgrade to continue to use this on privately hosted
						repos.
					</p>
					${when(
						inHolidayPromo,
						() =>
							html`<p style="text-align: center;">
								<a
									href=${'https://www.gitkraken.com/hs23?utm_source=holiday_special&utm_medium=gitlens_banner&utm_campaign=holiday_special_2023'}
									>Holiday Special: <b>50% off first seat of Pro</b> — only $4/month!<br
								/></a>
							</p>`,
						() =>
							html`<p style="text-align: center;">
								Special: <b>50% off first seat of Pro</b> — only $4/month!<br />
							</p>`,
					)}
				`;

			case SubscriptionState.FreePlusTrialReactivationEligible:
				return html`
					<gl-button appearance="${appearance}" href="command:gitlens.plus.reactivateProTrial"
						>Reactivate Pro Trial</gl-button
					>
					<p>
						You're eligible to reactivate your GitLens Pro trial and experience all the new Pro features —
						free for another 7 days!
					</p>
				`;
		}

		return undefined;
	}
}
