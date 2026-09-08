import { consume } from '@lit/context';
import * as l10n from '@vscode/l10n';
import { css, html, LitElement } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { localizedContent } from '@gitlens/components/localizedContent.js';
import { getNumericFormat } from '@gitlens/utils/date.js';
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
import '@gitlens/components/components/codeIcon.js';
import '../../../shared/components/promo.js';

declare global {
	interface HTMLElementTagNameMap {
		'gl-feature-gate-plus-state': GlFeatureGatePlusState;
	}

	// interface GlobalEventHandlersEventMap {}
}

/**
 * @tag gl-feature-gate-plus-state
 *
 * @slot feature
 */
@customElement('gl-feature-gate-plus-state')
export class GlFeatureGatePlusState extends LitElement {
	static override styles = [
		css`
			:host {
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

			/* Collapses the CTA to a block, centered button in narrow default-appearance gates.
  A deliberate literal — this threshold is independent of the compact threshold shared
  via featureGateCompactThreshold (and of the alert dialog's same-valued width cap). */
			@container (max-width: 60rem) {
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

			/* .trial's first paragraph is excluded: wrapping the trailing paragraphs made it a
  :first-child, which would newly zero its top margin at every size — full-size
  spacing must stay as it was before the wrapper existed. */
			:host([appearance='alert']) p:first-child:not(.trial p) {
				margin-top: 0;
			}

			:host([appearance='alert']) p:last-child {
				margin-bottom: 0;
			}

			.centered {
				text-align: center;
			}

			/* Centering lives on the wrapper (not the paragraphs) because the compact mode below
  turns the paragraphs inline — text-align only aligns content of block containers. */
			.trial {
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
				border-bottom: var(--gl-border-width) dashed currentcolor;
			}

			hr {
				border: none;
				border-top: var(--gl-border-width) solid
					color-mix(in srgb, var(--section-border-color) 20%, transparent);
			}
		`,
		linkStyles,
	];

	@query('gl-button')
	private readonly button?: GlButton;

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

	private _ctaPrimed = false;

	protected override updated(): void {
		// Prime the CTA for Enter — once, on the first update that actually renders a button
		// (`state` can arrive after the first render, which emits nothing until then). Don't
		// scroll it into view: in constrained placements the button sits far below the fold and
		// scrolling to it hides the gate's title/context. The latch keeps later reactive updates
		// (e.g. a subscription refresh) from stealing focus the user has since moved.
		if (this._ctaPrimed || this.appearance !== 'alert') return;

		const button = this.button;
		if (button == null) return;

		this._ctaPrimed = true;
		queueMicrotask(() => button.focus({ preventScroll: true }));
	}

	override render(): unknown {
		const hidden = this.state == null;
		// oxlint-disable-next-line lit/no-this-assign-in-render
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
							>${l10n.t('Resend Email')}</gl-button
						>
						<gl-button
							class="inline"
							href="${createCommandLink<Source>('gitlens.plus.validate', this.source)}"
							><code-icon icon="refresh"></code-icon
						></gl-button>
					</p>
					<hr />
					<p class="centered">
						${l10n.t("Check your inbox for a verification link, then refresh once you've verified.")}
					</p>
				`;

			case SubscriptionState.Community:
				if (this.featurePreview && getFeaturePreviewStatus(this.featurePreview) !== 'expired') {
					return html`${this.renderFeaturePreview(this.featurePreview)}`;
				}

				return html`<slot name="feature"></slot>
					<p class="centered">
						${localizedContent(this.featureRestriction === 'private-repos' ? l10n.t('Unlock this feature for privately hosted repos with {pro}.') : l10n.t('Unlock this feature with {pro}.'), { pro: html`<a href=${urls.communityVsPro}>GitLens Pro</a>` })}
					</p>
					<p class="actions-row">
						<gl-button
							class="inline"
							href="${createCommandLink<Source>('gitlens.plus.signUp', this.source)}"
							>&nbsp;${l10n.t('Try GitLens Pro')}&nbsp;</gl-button
						><span
							>${localizedContent(l10n.t('or {signIn}'), {
								signIn: html`<a
									href="${createCommandLink<Source>('gitlens.plus.login', this.source)}"
									title=${l10n.t('Sign In')}
									>${l10n.t('sign in')}</a
								>`,
							})}</span
						>
					</p>
					<hr />
					<p class="centered">
						<a href="${urls.communityVsPro}"
							>${l10n.t('Get {0} days of GitLens Pro free', getNumericFormat()(proTrialLengthInDays))}</a
						>
						${l10n.t('— no credit card required.')}
					</p>`;

			case SubscriptionState.TrialExpired:
				return html`<slot name="feature"></slot>
					<p class="centered">
						${localizedContent(this.featureRestriction === 'private-repos' ? l10n.t('Unlock this feature for privately hosted repos with {pro}.') : l10n.t('Unlock this feature with {pro}.'), { pro: html`<a href=${urls.communityVsPro}>GitLens Pro</a>` })}
					</p>
					<p class="actions-row">
						<gl-button
							class="inline"
							href="${createCommandLink<SubscriptionUpgradeCommandArgs>('gitlens.plus.upgrade', {
								plan: 'pro',
								...(this.source ?? { source: 'feature-gate' }),
							})}"
							>${l10n.t('Upgrade to Pro')}</gl-button
						>
					</p>
					<hr />
					<div class="trial">
						<p>
							${this.featureWithArticleIfNeeded ? l10n.t('Your trial has ended — upgrade to keep {feature} unlocked.', { feature: this.featureWithArticleIfNeeded }) : l10n.t('Your trial has ended — upgrade to keep all Pro features unlocked.')}
						</p>
						<p>${this.renderPromo()}</p>
					</div>`;

			case SubscriptionState.TrialReactivationEligible:
				return html`<slot name="feature"></slot>
					<p class="actions-row">
						<gl-button
							class="inline"
							href="${createCommandLink<Source>('gitlens.plus.reactivateProTrial', this.source)}"
							>${l10n.t('Continue')}</gl-button
						>
					</p>
					<hr />
					<p class="centered">
						${this.featureWithArticleIfNeeded ? l10n.t('Reactivate your Pro trial to experience {feature} and all the new Pro features — free for another {days} days.', { feature: this.featureWithArticleIfNeeded, days: getNumericFormat()(proTrialLengthInDays) }) : l10n.t('Reactivate your Pro trial to experience all the new Pro features — free for another {0} days.', getNumericFormat()(proTrialLengthInDays))}
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
					<gl-button href="${ifDefined(this.featurePreviewCommandLink)}">${l10n.t('Continue')}</gl-button>
				</p>
				<hr />
				<p class="centered">
					${l10n.t('Already have an account?')}
					<a href="${createCommandLink<Source>('gitlens.plus.login', this.source)}" title=${l10n.t('Sign In')}
						>${l10n.t('sign in')}</a
					><br />
					${appearance !== 'alert' ? html`<br />` : ''}
					<a href="${createCommandLink<Source>('gitlens.plus.signUp', this.source)}"
						>${l10n.t('Want full access to all Pro features? Start your free {0}-day Pro trial', proTrialLengthInDays)}</a
					>
					${l10n.t('— no credit card required.')}
				</p> `;
		}

		const left = proFeaturePreviewUsages - used;

		return html`
			${this.renderFeaturePreviewStep(featurePreview, used)}
			<p class="actions-row">
				<gl-button class="inline" href="${ifDefined(this.featurePreviewCommandLink)}"
					>${l10n.t('Continue Preview')}</gl-button
				><span
					>${localizedContent(l10n.t('or {signIn}'), {
						signIn: html`<a
							href="${createCommandLink<Source>('gitlens.plus.login', this.source)}"
							title=${l10n.t('Sign In')}
							>${l10n.t('sign in')}</a
						>`,
					})}</span
				>
			</p>
			<hr />
			<p class="centered">
				${this.featureWithArticleIfNeeded ? (left === 1 ? l10n.t('{days} more day to preview {feature} on privately hosted repos.', { days: getNumericFormat()(left), feature: this.featureWithArticleIfNeeded }) : l10n.t('{days} more days to preview {feature} on privately hosted repos.', { days: getNumericFormat()(left), feature: this.featureWithArticleIfNeeded })) : left === 1 ? l10n.t('{0} more day to preview privately hosted repos.', getNumericFormat()(left)) : l10n.t('{0} more days to preview privately hosted repos.', getNumericFormat()(left))}<br />
				${appearance !== 'alert' ? html`<br />` : ''}
				<a href="${createCommandLink<Source>('gitlens.plus.signUp', this.source)}"
					>${l10n.t('Want full access to all Pro features? Start your free {0}-day Pro trial', proTrialLengthInDays)}</a
				>
				${l10n.t('— no credit card required.')}
			</p>
		`;
	}

	private renderFeaturePreviewStep(featurePreview: FeaturePreview, used: number) {
		switch (featurePreview.feature) {
			case 'graph':
				switch (used) {
					case 1:
						return html`<p>${l10n.t('Try Commit Search')}</p>
							<p>
								${l10n.t('Search for commits in your repo by author, commit message, SHA, file, change, or type. Turn on the commit filter to show only commits that match your query.')}
							</p>
							<p>
								<img
									class="preview-image"
									src="${this.webroot ?? ''}/media/graph-commit-search.webp"
									alt=${l10n.t('Graph Commit Search')}
								/>
							</p> `;

					case 2:
						return html`
							<p>${l10n.t('Try the Graph Minimap')}</p>
							<p>
								${l10n.t('Visualize the amount of changes to a repository over time, and inspect specific points in the history to locate branches, stashes, tags and pull requests.')}
							</p>
							<p>
								<img
									class="preview-image"
									src="${this.webroot ?? ''}/media/graph-minimap.webp"
									alt=${l10n.t('Graph Minimap')}
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
