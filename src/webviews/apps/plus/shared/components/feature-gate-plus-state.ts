import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { urls } from '../../../../../constants';
import {
	proFeaturePreviewUsages,
	proTrialLengthInDays,
	SubscriptionState,
} from '../../../../../constants.subscription';
import type { Source } from '../../../../../constants.telemetry';
import type { FeaturePreview } from '../../../../../features';
import { getFeaturePreviewStatus } from '../../../../../features';
import type { SubscriptionUpgradeCommandArgs } from '../../../../../plus/gk/models/subscription';
import { createCommandLink } from '../../../../../system/commands';
import { pluralize } from '../../../../../system/string';
import type { GlButton } from '../../../shared/components/button';
import type { PromosContext } from '../../../shared/contexts/promos';
import { promosContext } from '../../../shared/contexts/promos';
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
		css`
			:host {
				--gk-action-radius: 0.3rem;

				--link-foreground: var(--vscode-textLink-foreground);
				--link-foreground-active: var(--vscode-textLink-activeForeground);
			}

			:host([appearance='alert']) {
				--link-decoration-default: underline;
				--link-foreground: color-mix(in srgb, var(--section-foreground) 50%, var(--vscode-textLink-foreground));
				--link-foreground-active: color-mix(
					in srgb,
					var(--section-foreground) 50%,
					var(--vscode-textLink-activeForeground)
				);
			}

			:host([appearance='default']) gl-button:only-child {
				width: 100%;
				max-width: 300px;
			}

			@container (max-width: 600px) {
				:host([appearance='default']) gl-button:not(.inline) {
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
		linkStyles,
	];

	@query('gl-button')
	private readonly button!: GlButton;

	@property()
	appearance?: 'alert' | 'default';

	@property({ type: Object })
	featurePreview?: FeaturePreview;

	@property()
	featurePreviewCommandLink?: string;

	@property()
	featureRestriction?: 'all' | 'private-repos';

	@property()
	featureWithArticleIfNeeded?: string;

	@consume({ context: promosContext })
	private promos!: PromosContext;

	@property({ type: Object })
	source?: Source;

	@property({ attribute: false, type: Number })
	state?: SubscriptionState;

	@property()
	webroot?: string;

	protected override firstUpdated(): void {
		if (this.appearance === 'alert') {
			queueMicrotask(() => this.button.focus());
		}
	}

	override render(): unknown {
		const hidden = this.state == null;
		// eslint-disable-next-line lit/no-this-assign-in-render
		this.hidden = hidden;
		if (hidden) return undefined;

		const appearance = (this.appearance ?? 'alert') === 'alert' ? 'alert' : undefined;

		switch (this.state) {
			case SubscriptionState.VerificationRequired:
				return html`
					<slot name="feature"></slot>
					<p class="actions">
						<gl-button
							class="inline"
							appearance="${ifDefined(appearance)}"
							href="${createCommandLink<Source>('gitlens.plus.resendVerification', this.source)}"
							>Resend Email</gl-button
						>
						<gl-button
							class="inline"
							appearance="${ifDefined(appearance)}"
							href="${createCommandLink<Source>('gitlens.plus.validate', this.source)}"
							><code-icon icon="refresh"></code-icon
						></gl-button>
					</p>
					<p>You must verify your email before you can continue.</p>
				`;

			case SubscriptionState.Community:
				if (this.featurePreview && getFeaturePreviewStatus(this.featurePreview) !== 'expired') {
					return html`${this.renderFeaturePreview(this.featurePreview)}`;
				}

				return html`<slot name="feature"></slot>
					<p>
						${this.featureRestriction === 'private-repos'
							? 'Unlock this feature for privately hosted repos with '
							: 'Unlock this feature with '} <a href="${urls.communityVsPro}">GitLens Pro</a>.
					</p>
					<p class="actions-row">
						<gl-button
							class="inline"
							appearance="${ifDefined(appearance)}"
							href="${createCommandLink<Source>('gitlens.plus.signUp', this.source)}"
							>&nbsp;Try GitLens Pro&nbsp;</gl-button
						><span
							>or
							<a href="${createCommandLink<Source>('gitlens.plus.login', this.source)}" title="Sign In"
								>sign in</a
							></span
						>
					</p>
					<p>
						Get ${pluralize('day', proTrialLengthInDays)} of
						<a href="${urls.communityVsPro}">GitLens Pro</a> for free — no credit card required.
					</p>`;

			case SubscriptionState.TrialExpired:
				return html`<slot name="feature"></slot>
					<p>
						${this.featureRestriction === 'private-repos'
							? 'Unlock this feature for privately hosted repos with '
							: 'Unlock this feature with '} <a href="${urls.communityVsPro}">GitLens Pro</a>.
					</p>
					<p class="actions-row">
						<gl-button
							class="inline"
							appearance="${ifDefined(appearance)}"
							href="${createCommandLink<SubscriptionUpgradeCommandArgs>('gitlens.plus.upgrade', {
								plan: 'pro',
								...(this.source ?? { source: 'feature-gate' }),
							})}"
							>Upgrade to Pro</gl-button
						>
					</p>
					<p>${this.renderPromo()}</p>`;

			case SubscriptionState.TrialReactivationEligible:
				return html`<slot name="feature"></slot>
					<p class="actions-row">
						<gl-button
							class="inline"
							appearance="${ifDefined(appearance)}"
							href="${createCommandLink<Source>('gitlens.plus.reactivateProTrial', this.source)}"
							>Continue</gl-button
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
		const appearance = (this.appearance ?? 'alert') === 'alert' ? 'alert' : undefined;
		const used = featurePreview.usages.length;

		if (used === 0) {
			return html`<slot name="feature"></slot>
				<gl-button appearance="${ifDefined(appearance)}" href="${ifDefined(this.featurePreviewCommandLink)}"
					>Continue</gl-button
				>
				<p>
					Continue to preview
					${this.featureWithArticleIfNeeded ? `${this.featureWithArticleIfNeeded} on` : ''} privately hosted
					repos, or
					<a href="${createCommandLink<Source>('gitlens.plus.login', this.source)}" title="Sign In">sign in</a
					>.<br />
					${appearance !== 'alert' ? html`<br />` : ''} For full access to all GitLens Pro features,
					<a href="${createCommandLink<Source>('gitlens.plus.signUp', this.source)}"
						>start your free ${proTrialLengthInDays}-day Pro trial</a
					>
					— no credit card required.
				</p> `;
		}

		const left = proFeaturePreviewUsages - used;

		return html`
			${this.renderFeaturePreviewStep(featurePreview, used)}
			<p class="actions-row">
				<gl-button
					class="inline"
					appearance="${ifDefined(appearance)}"
					href="${ifDefined(this.featurePreviewCommandLink)}"
					>Continue Preview</gl-button
				><span
					>or
					<a href="${createCommandLink<Source>('gitlens.plus.login', this.source)}" title="Sign In"
						>sign in</a
					></span
				>
			</p>
			<p>
				After continuing, you will have ${pluralize('day', left, { infix: ' more ' })} to preview
				${this.featureWithArticleIfNeeded ? `${this.featureWithArticleIfNeeded} on` : ''} privately hosted
				repos.<br />
				${appearance !== 'alert' ? html`<br />` : ''} For full access to all GitLens Pro features,
				<a href="${createCommandLink<Source>('gitlens.plus.signUp', this.source)}"
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

	private renderPromo() {
		return html`<gl-promo
			.promoPromise=${this.promos.getApplicablePromo(undefined, 'gate')}
			.source=${this.source}
		></gl-promo>`;
	}
}
