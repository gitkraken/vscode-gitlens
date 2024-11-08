import type { TemplateResult } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { urls } from '../../../../../constants';
import { Commands } from '../../../../../constants.commands';
import { proPreviewLengthInDays, proTrialLengthInDays, SubscriptionState } from '../../../../../constants.subscription';
import type { Source, Sources } from '../../../../../constants.telemetry';
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

	@property({ type: Object })
	featureInPreviewTrial?: {
		[key in Sources]?: { consumedDays: { startedOn: string; expiresOn: string }[]; isActive: boolean };
	};

	@property({ type: String })
	featurePreviewTrialCommandLink?: string;

	@property({ type: String })
	appearance?: 'alert' | 'welcome';

	@property()
	featureWithArticleIfNeeded?: string;

	@property({ type: Object })
	source?: Source;

	@property({ attribute: false, type: Number })
	state?: SubscriptionState;

	@property({ type: String })
	webroot?: string;

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
		let consumedDaysCount = 0;
		const feature = this.source?.source;
		if (feature) {
			consumedDaysCount = this.featureInPreviewTrial?.[feature]?.consumedDays?.length ?? 0;
		}

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
				if (
					this.state === SubscriptionState.Community &&
					feature &&
					this.featureInPreviewTrial?.[feature] &&
					proPreviewLengthInDays - consumedDaysCount > 0
				) {
					return html`
						${this.getFeaturePreviewModalFor(feature, proPreviewLengthInDays - consumedDaysCount)}
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

	private getFeaturePreviewModalFor(feature: Sources, daysLeft: number) {
		const appearance = (this.appearance ?? 'alert') === 'alert' ? 'alert' : nothing;
		let partial: TemplateResult<1> | undefined;
		switch (feature) {
			case 'graph':
				switch (daysLeft) {
					case 2:
						partial = html`<p>Try Commit Search</p>
							<p>
								Search for commits in your repo by author, commit message, SHA, file, change, or type.
								Turn on the commit filter to show only commits that match your query.
							</p>
							<p>
								<img
									src="${this.webroot ?? ''}/media/graph-commit-search.webp"
									style="width:100%"
									alt="Graph Commit Search"
								/>
							</p> `;
						break;
					case 1:
						partial = html`
							<p>Try the Graph Minimap</p>
							<p>
								Visualize the amount of changes to a repository over time, and inspect specific points
								in the history to locate branches, stashes, tags and pull requests.
							</p>
							<p>
								<img
									src="${this.webroot ?? ''}/media/graph-minimap.webp"
									style="width:100%"
									alt="Graph Minimap"
								/>
							</p>
						`;
						break;
				}
				return html`
					${partial}
					<gl-button appearance="${appearance}" href="${this.featurePreviewTrialCommandLink}"
						>Continue</gl-button
					>
					<p>
						Continuing gives you ${pluralize('day', daysLeft)} to preview
						${this.featureWithArticleIfNeeded ? `${this.featureWithArticleIfNeeded} on` : ''}
						privately-hosted repositories.<br />
						${appearance !== 'alert' ? html`<br />` : ''} For full access to all GitLens Pro features,
						<a href="${generateCommandLink(Commands.PlusSignUp, this.source)}"
							>start your free ${proTrialLengthInDays}-day Pro trial</a
						>
						- no credit card required. Or
						<a href="${generateCommandLink(Commands.PlusLogin, this.source)}" title="Sign In">sign in</a>.
					</p>
				`;
			default:
				return html`
					<gl-button appearance="${appearance}" href="${this.featurePreviewTrialCommandLink}"
						>Continue</gl-button
					>
					<p>
						Continuing gives you ${pluralize('day', daysLeft)} to preview
						${this.featureWithArticleIfNeeded ? `${this.featureWithArticleIfNeeded} on` : ''}
						privately-hosted repositories.<br />
						${appearance !== 'alert' ? html`<br />` : ''} For full access to all GitLens Pro features,
						<a href="${generateCommandLink(Commands.PlusSignUp, this.source)}"
							>start your free ${proTrialLengthInDays}-day Pro trial</a
						>
						- no credit card required. Or
						<a href="${generateCommandLink(Commands.PlusLogin, this.source)}" title="Sign In">sign in</a>.
					</p>
				`;
		}
	}
}

function generateCommandLink(command: Commands, source: Source | undefined) {
	return `command:${command}${source ? `?${encodeURIComponent(JSON.stringify(source))}` : ''}`;
}
