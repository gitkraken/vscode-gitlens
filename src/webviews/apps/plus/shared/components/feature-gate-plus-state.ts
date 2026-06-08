import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { pluralize } from '@gitlens/utils/string.js';
import { urls } from '../../../../../constants.js';
import {
	proFeaturePreviewUsages,
	proTrialLengthInDays,
	SubscriptionState,
} from '../../../../../constants.subscription.js';
import type { Source } from '../../../../../constants.telemetry.js';
import type { FeaturePreview } from '../../../../../features.js';
import { getFeaturePreviewStatus } from '../../../../../features.js';
import type { SubscriptionUpgradeCommandArgs } from '../../../../../plus/gk/models/subscription.js';
import { createCommandLink } from '../../../../../system/commands.js';
import type { GlButton } from '../../../shared/components/button.js';
import type { PromosContext } from '../../../shared/contexts/promos.js';
import { promosContext } from '../../../shared/contexts/promos.js';
import { linkStyles } from './vscode.css.js';
import '../../../shared/components/button.js';
import '../../../shared/components/promo.js';

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
				--gl-action-radius: 0.3rem;

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
					margin-right: auto;
					margin-left: auto;
				}
			}

			:host([appearance='alert']) gl-button:not(.inline) {
				display: block;
				margin-right: auto;
				margin-left: auto;
			}

			:host-context([appearance='alert']) p:first-child {
				margin-top: 0;
			}

			:host-context([appearance='alert']) p:last-child {
				margin-bottom: 0;
			}

			.centered {
				text-align: center;
			}

			.preview-image {
				width: 100%;
			}

			.actions-row {
				display: flex;
				gap: 0.6em;
				align-items: baseline;
				justify-content: center;
				white-space: nowrap;
			}

			/* Like .actions-row but center-aligned, for a row that mixes a text button with an
			   icon-only button: their baselines don't match (a text baseline vs the synthesized
			   bottom edge of the icon button's flex box), so centering the equal-height button
			   boxes is what lines them up. */
			.actions-row-center {
				display: flex;
				gap: 0.6em;
				align-items: center;
				justify-content: center;
				white-space: nowrap;
			}

			.hint {
				border-bottom: 1px dashed currentcolor;
			}

			hr {
				border: none;
				border-top: 1px solid color-mix(in srgb, var(--section-border-color) 20%, transparent);
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

		switch (this.state) {
			case SubscriptionState.VerificationRequired:
				return html`
					<slot name="feature"></slot>
					<p class="actions-row-center">
						<gl-button
							class="inline"
							href="${createCommandLink<Source>('gitlens.plus.resendVerification', this.source)}"
							>Resend Email</gl-button
						>
						<gl-button
							class="inline"
							href="${createCommandLink<Source>('gitlens.plus.validate', this.source)}"
							><code-icon icon="refresh"></code-icon
						></gl-button>
					</p>
					<hr />
					<p class="centered">Check your inbox for a verification link, then refresh once you've verified.</p>
				`;

			case SubscriptionState.Community:
				if (this.featurePreview && getFeaturePreviewStatus(this.featurePreview) !== 'expired') {
					return html`${this.renderFeaturePreview(this.featurePreview)}`;
				}

				return html`<slot name="feature"></slot>
					<p class="centered">
						${this.featureRestriction === 'private-repos'
							? 'Unlock this feature for privately hosted repos with '
							: 'Unlock this feature with '} <a href="${urls.communityVsPro}">GitLens Pro</a>.
					</p>
					<p class="actions-row">
						<gl-button
							class="inline"
							href="${createCommandLink<Source>('gitlens.plus.signUp', this.source)}"
							>&nbsp;Try GitLens Pro&nbsp;</gl-button
						><span
							>or
							<a href="${createCommandLink<Source>('gitlens.plus.login', this.source)}" title="Sign In"
								>sign in</a
							></span
						>
					</p>
					<hr />
					<p class="centered">
						<a href="${urls.communityVsPro}"
							>Get ${pluralize('day', proTrialLengthInDays)} of GitLens Pro free</a
						>
						— no credit card required.
					</p>`;

			case SubscriptionState.TrialExpired:
				return html`<slot name="feature"></slot>
					<p class="centered">
						${this.featureRestriction === 'private-repos'
							? 'Unlock this feature for privately hosted repos with '
							: 'Unlock this feature with '} <a href="${urls.communityVsPro}">GitLens Pro</a>.
					</p>
					<p class="actions-row">
						<gl-button
							class="inline"
							href="${createCommandLink<SubscriptionUpgradeCommandArgs>('gitlens.plus.upgrade', {
								plan: 'pro',
								...(this.source ?? { source: 'feature-gate' }),
							})}"
							>Upgrade to Pro</gl-button
						>
					</p>
					<hr />
					<p class="centered">
						Your trial has ended — upgrade to keep ${this.featureWithArticleIfNeeded ?? 'all Pro features'}
						unlocked.
					</p>
					<p class="centered">${this.renderPromo()}</p>`;

			case SubscriptionState.TrialReactivationEligible:
				return html`<slot name="feature"></slot>
					<p class="actions-row">
						<gl-button
							class="inline"
							href="${createCommandLink<Source>('gitlens.plus.reactivateProTrial', this.source)}"
							>Continue</gl-button
						>
					</p>
					<hr />
					<p class="centered">
						Reactivate your Pro trial to experience
						${this.featureWithArticleIfNeeded ? `${this.featureWithArticleIfNeeded} and ` : ''}all the new
						Pro features — free for another ${pluralize('day', proTrialLengthInDays)}.
					</p> `;
		}

		return undefined;
	}

	private renderFeaturePreview(featurePreview: FeaturePreview) {
		const appearance = (this.appearance ?? 'alert') === 'alert' ? 'alert' : undefined;
		const used = featurePreview.usages.length;

		if (used === 0) {
			return html`<slot name="feature"></slot>
				<p class="actions-row">
					<gl-button href="${ifDefined(this.featurePreviewCommandLink)}">Continue</gl-button>
				</p>
				<hr />
				<p class="centered">
					Already have an account?
					<a href="${createCommandLink<Source>('gitlens.plus.login', this.source)}" title="Sign In">sign in</a
					><br />
					${appearance !== 'alert' ? html`<br />` : ''}
					<a href="${createCommandLink<Source>('gitlens.plus.signUp', this.source)}"
						>Want full access to all Pro features? Start your free ${proTrialLengthInDays}-day Pro trial</a
					>
					— no credit card required.
				</p> `;
		}

		const left = proFeaturePreviewUsages - used;

		return html`
			${this.renderFeaturePreviewStep(featurePreview, used)}
			<p class="actions-row">
				<gl-button class="inline" href="${ifDefined(this.featurePreviewCommandLink)}"
					>Continue Preview</gl-button
				><span
					>or
					<a href="${createCommandLink<Source>('gitlens.plus.login', this.source)}" title="Sign In"
						>sign in</a
					></span
				>
			</p>
			<hr />
			<p class="centered">
				${pluralize('day', left, { infix: ' more ' })} to preview
				${this.featureWithArticleIfNeeded ? `${this.featureWithArticleIfNeeded} on ` : ''}privately hosted
				repos.<br />
				${appearance !== 'alert' ? html`<br />` : ''}
				<a href="${createCommandLink<Source>('gitlens.plus.signUp', this.source)}"
					>Want full access to all Pro features? Start your free ${proTrialLengthInDays}-day Pro trial</a
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
									class="preview-image"
									src="${this.webroot ?? ''}/media/graph-commit-search.webp"
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
									class="preview-image"
									src="${this.webroot ?? ''}/media/graph-minimap.webp"
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
