import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { urls } from '../../../../../constants';
import { Commands } from '../../../../../constants.commands';
import { proTrialLengthInDays, SubscriptionState } from '../../../../../constants.subscription';
import type { Source } from '../../../../../constants.telemetry';
import type { Promo } from '../../../../../plus/gk/account/promos';
import { getApplicablePromo } from '../../../../../plus/gk/account/promos';
import { pluralize } from '../../../../../system/string';
import type { GlButton } from '../../../shared/components/button';
import { linkStyles } from './vscode.css';
import '../../../shared/components/button';
import '../../../shared/components/promo';

declare global {
	interface HTMLElementTagNameMap {
		'gl-feature-gate-plus-state': GlFeatureGatePlusState;
	}

	// interface GlobalEventHandlersEventMap {}
}

@customElement('gl-feature-gate-plus-state')
export class GlFeatureGatePlusState extends LitElement {
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
		`,
	];

	@query('gl-button')
	private readonly button!: GlButton;

	@property({ type: String })
	appearance?: 'alert' | 'welcome';

	@property()
	featureWithArticleIfNeeded?: string;

	@property({ type: Object })
	source?: Source;

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
		const promo = this.state ? getApplicablePromo(this.state, 'gate') : undefined;

		const feature = this.source?.source || '';

		switch (this.state) {
			case SubscriptionState.VerificationRequired:
				return html`
					<p class="actions">
						<gl-button
							class="inline"
							appearance="${appearance}"
							href="${generateCommandLink(Commands.PlusResendVerification, this.source)}"
							>Resend Email</gl-button
						>
						<gl-button
							class="inline"
							appearance="${appearance}"
							href="${generateCommandLink(Commands.PlusValidate, this.source)}"
							><code-icon icon="refresh"></code-icon
						></gl-button>
					</p>
					<p>You must verify your email before you can continue.</p>
				`;

			case SubscriptionState.Community:
			case SubscriptionState.ProPreviewExpired:
				if (feature === 'graph' && this.state === SubscriptionState.Community) {
					return html`
						<gl-button
							appearance="${appearance}"
							href="${generateCommandLink(Commands.PlusStartPreviewTrial, this.source)}"
							>Continue</gl-button
						>
						<p>
							Continuing gives you 3 days to preview
							${this.featureWithArticleIfNeeded
								? `${this.featureWithArticleIfNeeded}  and other `
								: ''}local
							Pro features.<br />
							${appearance !== 'alert' ? html`<br />` : ''} For full access to Pro features
							<a href="${generateCommandLink(Commands.PlusSignUp, this.source)}"
								>start your free ${proTrialLengthInDays}-day Pro trial</a
							>
							or
							<a href="${generateCommandLink(Commands.PlusLogin, this.source)}" title="Sign In">sign in</a
							>.
						</p>
					`;
				}

				return html`<p>
						Use on privately-hosted repos requires
						<a href="${urls.gitlensProVsCommunity}">GitLens Pro</a>.
					</p>
					<gl-button
						appearance="${appearance}"
						href="${generateCommandLink(Commands.PlusSignUp, this.source)}"
						>&nbsp;Try GitLens Pro&nbsp;</gl-button
					>
					<p>
						Get ${proTrialLengthInDays} days of GitLens Pro for free - no credit card required. Or
						<a href="${generateCommandLink(Commands.PlusLogin, this.source)}" title="Sign In">sign in</a>.
					</p> `;

			case SubscriptionState.ProTrialExpired:
				return html`<p>
						Use on privately-hosted repos requires <a href="${urls.gitlensProVsCommunity}">GitLens Pro</a>.
					</p>
					<gl-button
						appearance="${appearance}"
						href="${generateCommandLink(Commands.PlusUpgrade, this.source)}"
						>Upgrade to Pro</gl-button
					>
					${this.renderPromo(promo)}`;

			case SubscriptionState.ProTrialReactivationEligible:
				return html`
					<gl-button
						appearance="${appearance}"
						href="${generateCommandLink(Commands.PlusReactivateProTrial, this.source)}"
						>Continue</gl-button
					>
					<p>
						Reactivate your Pro trial and experience
						${this.featureWithArticleIfNeeded ? `${this.featureWithArticleIfNeeded} and ` : ''}all the new
						Pro features — free for another ${pluralize('day', proTrialLengthInDays)}!
					</p>
				`;
		}

		return undefined;
	}

	private renderPromo(promo: Promo | undefined) {
		return html`<gl-promo .promo=${promo}></gl-promo>`;
	}
}

function generateCommandLink(command: Commands, source: Source | undefined) {
	return `command:${command}${source ? `?${encodeURIComponent(JSON.stringify(source))}` : ''}`;
}
