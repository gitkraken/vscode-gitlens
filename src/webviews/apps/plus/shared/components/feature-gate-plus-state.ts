import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { SubscriptionState } from '../../../../../plus/gk/account/subscription';
import type { GlButton } from '../../../shared/components/button';
import { linkStyles } from './vscode.css';
import '../../../shared/components/button';

@customElement('gl-feature-gate-plus-state')
export class FeatureGatePlusState extends LitElement {
	static override styles = [
		linkStyles,
		css`
			:host {
				--gk-action-radius: 0.3rem;
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

			:host([appearance='alert']) gl-button:not(.inline) {
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

			.actions {
				text-align: center;
			}

			.hint {
				border-bottom: 1px dashed currentColor;
			}

			.special {
				font-size: smaller;
				text-align: center;
			}

			:host([appearance='welcome']) .special {
				opacity: 0.6;
			}
		`,
	];

	@query('gl-button')
	private readonly button!: GlButton;

	@property({ type: String })
	appearance?: 'alert' | 'welcome';

	@property()
	featureWithArticleIfNeeded?: string;

	@property({ attribute: false, type: Number })
	state?: SubscriptionState;

	protected override firstUpdated() {
		if (this.appearance === 'alert') {
			queueMicrotask(() => this.button.focus());
		}
	}

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
					<p class="actions">
						<gl-button
							class="inline"
							appearance="${appearance}"
							href="command:gitlens.plus.resendVerification"
							>Resend Email</gl-button
						>
						<gl-button class="inline" appearance="${appearance}" href="command:gitlens.plus.validate"
							><code-icon icon="refresh"></code-icon
						></gl-button>
					</p>
					<p>You must verify your email before you can continue.</p>
				`;

			case SubscriptionState.Free:
				return html`
					<gl-button appearance="${appearance}" href="command:gitlens.plus.startPreviewTrial"
						>Continue</gl-button
					>
					<p>
						Continuing gives you 3 days to preview
						${this.featureWithArticleIfNeeded ? `${this.featureWithArticleIfNeeded}  and other ` : ''}local
						Pro features.<br />
						${appearance !== 'alert' ? html`<br />` : ''} For full access to Pro features
						<a href="command:gitlens.plus.signUp">start your free 7-day Pro trial</a> or
						<a href="command:gitlens.plus.login" title="Sign In">sign in</a>.
					</p>
				`;

			case SubscriptionState.FreePreviewTrialExpired:
				return html`
					<gl-button appearance="${appearance}" href="command:gitlens.plus.signUp">Start Pro Trial</gl-button>
					<p>
						Start your free 7-day Pro trial to try
						${this.featureWithArticleIfNeeded ? `${this.featureWithArticleIfNeeded} and other ` : ''}Pro
						features, or
						<a href="command:gitlens.plus.login" title="Sign In">sign in</a>.
					</p>
				`;

			case SubscriptionState.FreePlusTrialExpired:
				return html` <gl-button appearance="${appearance}" href="command:gitlens.plus.purchase"
						>Upgrade to Pro</gl-button
					>
					<p>
						Your Pro trial has ended. Please upgrade to continue to use
						${this.featureWithArticleIfNeeded ? `${this.featureWithArticleIfNeeded} and other ` : ''}Pro
						features on privately-hosted repos.
					</p>
					<p class="special">Special: <b>50% off first seat of Pro</b> — only $4/month!<br /></p>`;

			case SubscriptionState.FreePlusTrialReactivationEligible:
				return html`
					<gl-button appearance="${appearance}" href="command:gitlens.plus.reactivateProTrial"
						>Continue</gl-button
					>
					<p>
						Reactivate your Pro trial and experience
						${this.featureWithArticleIfNeeded ? `${this.featureWithArticleIfNeeded} and ` : ''}all the new
						Pro features — free for another 7 days!
					</p>
				`;
		}

		return undefined;
	}
}
