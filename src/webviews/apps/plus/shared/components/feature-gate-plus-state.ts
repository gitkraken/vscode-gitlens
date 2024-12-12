import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { urls } from '../../../../../constants';
import type { GlCommands } from '../../../../../constants.commands';
import { GlCommand } from '../../../../../constants.commands';
import {
	proFeaturePreviewUsages,
	proTrialLengthInDays,
	SubscriptionState,
} from '../../../../../constants.subscription';
import type { Source } from '../../../../../constants.telemetry';
import type { FeaturePreview } from '../../../../../features';
import { getFeaturePreviewStatus } from '../../../../../features';
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
				:host([appearance='welcome']) gl-button:not(.inline) {
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

			.actions-row {
				display: flex;
				gap: 0.6em;
				align-items: baseline;
				justify-content: center;
				white-space: nowrap;
			}

			.hint {
				border-bottom: 1px dashed currentColor;
			}
		`,
	];

	@query('gl-button')
	private readonly button!: GlButton;

	@property({ type: Object })
	featurePreview?: FeaturePreview;

	@property({ type: String })
	featurePreviewCommandLink?: string;

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

		switch (this.state) {
			case SubscriptionState.VerificationRequired:
				return html`
					<slot name="feature"></slot>
					<p class="actions">
						<gl-button
							class="inline"
							appearance="${appearance}"
							href="${generateCommandLink(GlCommand.PlusResendVerification, this.source)}"
							>Resend Email</gl-button
						>
						<gl-button
							class="inline"
							appearance="${appearance}"
							href="${generateCommandLink(GlCommand.PlusValidate, this.source)}"
							><code-icon icon="refresh"></code-icon
						></gl-button>
					</p>
					<p>You must verify your email before you can continue.</p>
				`;

			// case SubscriptionState.Community:
			// 	return html`
			// 		<gl-button
			// 			appearance="${appearance}"
			// 			href="${generateCommandLink(Commands.PlusStartPreviewTrial, this.source)}"
			// 			>Continue</gl-button
			// 		>
			// 		<p>
			// 			Continuing gives you 3 days to preview
			// 			${this.featureWithArticleIfNeeded ? `${this.featureWithArticleIfNeeded}  and other ` : ''}local
			// 			Pro features.<br />
			// 			${appearance !== 'alert' ? html`<br />` : ''} For full access to Pro features
			// 			<a href="${generateCommandLink(Commands.PlusSignUp, this.source)}"
			// 				>start your free ${proTrialLengthInDays}-day Pro trial</a
			// 			>
			// 			or
			// 			<a href="${generateCommandLink(Commands.PlusLogin, this.source)}" title="Sign In">sign in</a>.
			// 		</p>
			// 	`;
			case SubscriptionState.Community:
			case SubscriptionState.ProPreviewExpired:
				if (this.featurePreview && getFeaturePreviewStatus(this.featurePreview) !== 'expired') {
					return html`${this.renderFeaturePreview(this.featurePreview)}`;
				}

				return html`<slot name="feature"></slot>
					<p>
						Use on privately-hosted repos requires
						<a href="${urls.communityVsPro}">GitLens Pro</a>.
					</p>
					<p class="actions-row">
						<gl-button
							class="inline"
							appearance="${appearance}"
							href="${generateCommandLink(GlCommand.PlusSignUp, this.source)}"
							>&nbsp;Try GitLens Pro&nbsp;</gl-button
						><span
							>or
							<a href="${generateCommandLink(GlCommand.PlusLogin, this.source)}" title="Sign In"
								>sign in</a
							></span
						>
					</p>
					<p>
						Get ${pluralize('day', proTrialLengthInDays)} of
						<a href="${urls.communityVsPro}">GitLens Pro</a> for free — no credit card required.
					</p>`;

			case SubscriptionState.ProTrialExpired:
				return html`<slot name="feature"></slot>
					<p>Use on privately-hosted repos requires <a href="${urls.communityVsPro}">GitLens Pro</a>.</p>
					<p class="actions-row">
						<gl-button
							class="inline"
							appearance="${appearance}"
							href="${generateCommandLink(GlCommand.PlusUpgrade, this.source)}"
							>Upgrade to Pro</gl-button
						><span
							>or
							<a href="${generateCommandLink(GlCommand.PlusLogin, this.source)}" title="Sign In"
								>sign in</a
							></span
						>
					</p>
					<p>${this.renderPromo(promo)}</p>`;

			case SubscriptionState.ProTrialReactivationEligible:
				return html`<slot name="feature"></slot>
					<p class="actions-row">
						<gl-button
							class="inline"
							appearance="${appearance}"
							href="${generateCommandLink(GlCommand.PlusReactivateProTrial, this.source)}"
							>Continue</gl-button
						><span
							>or
							<a href="${generateCommandLink(GlCommand.PlusLogin, this.source)}" title="Sign In"
								>sign in</a
							></span
						>
					</p>
					<p>
						Reactivate your GitLens Pro trial and experience
						${this.featureWithArticleIfNeeded ? `${this.featureWithArticleIfNeeded} and ` : ''}all the new
						Pro features — free for another ${pluralize('day', proTrialLengthInDays)}!
					</p> `;
		}

		return undefined;
	}

	private renderFeaturePreview(featurePreview: FeaturePreview) {
		const appearance = (this.appearance ?? 'alert') === 'alert' ? 'alert' : nothing;
		const used = featurePreview.usages.length;

		if (used === 0) {
			return html`<slot name="feature"></slot>
				<gl-button appearance="${appearance}" href="${this.featurePreviewCommandLink}">Continue</gl-button>
				<p>
					Continue to preview
					${this.featureWithArticleIfNeeded ? `${this.featureWithArticleIfNeeded} on` : ''} privately-hosted
					repos, or
					<a href="${generateCommandLink(GlCommand.PlusLogin, this.source)}" title="Sign In">sign in</a
					>.<br />
					${appearance !== 'alert' ? html`<br />` : ''} For full access to all GitLens Pro features,
					<a href="${generateCommandLink(GlCommand.PlusSignUp, this.source)}"
						>start your free ${proTrialLengthInDays}-day Pro trial</a
					>
					— no credit card required.
				</p> `;
		}

		const left = proFeaturePreviewUsages - used;

		return html`
			${this.renderFeaturePreviewStep(featurePreview, used)}
			<p class="actions-row">
				<gl-button class="inline" appearance="${appearance}" href="${this.featurePreviewCommandLink}"
					>Continue Preview</gl-button
				><span
					>or
					<a href="${generateCommandLink(GlCommand.PlusLogin, this.source)}" title="Sign In">sign in</a></span
				>
			</p>
			<p>
				After continuing, you will have ${pluralize('day', left, { infix: ' more ' })} to preview
				${this.featureWithArticleIfNeeded ? `${this.featureWithArticleIfNeeded} on` : ''} privately-hosted
				repos.<br />
				${appearance !== 'alert' ? html`<br />` : ''} For full access to all GitLens Pro features,
				<a href="${generateCommandLink(GlCommand.PlusSignUp, this.source)}"
					>start your free ${proTrialLengthInDays}-day Pro trial</a
				>
				— no credit card required.
			</p>
		`;
	}

	private renderFeaturePreviewStep(featurePreview: FeaturePreview, used: number) {
		switch (featurePreview.feature) {
			case 'graph':
				switch (used) {
					case 1:
						return html`<p>Try Commit Search</p>
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

					case 2:
						return html`
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

					default:
						return html`<slot name="feature"></slot>`;
				}

			default:
				return html`<slot name="feature"></slot>`;
		}
	}

	private renderPromo(promo: Promo | undefined) {
		return html`<gl-promo .promo=${promo}></gl-promo>`;
	}
}

function generateCommandLink(command: GlCommands, source: Source | undefined) {
	return `command:${command}${source ? `?${encodeURIComponent(JSON.stringify(source))}` : ''}`;
}
