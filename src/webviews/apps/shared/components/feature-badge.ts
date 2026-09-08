import { consume } from '@lit/context';
import * as l10n from '@vscode/l10n';
import type { TemplateResult } from 'lit';
import { css, html, LitElement, nothing, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { GlPopover } from '@gitlens/components/components/overlays/popover.js';
import { focusOutline } from '@gitlens/components/components/styles/lit/a11y.css.js';
import { boxSizingBase, linkBase } from '@gitlens/components/components/styles/lit/base.css.js';
import { localizedContent } from '@gitlens/components/localizedContent.js';
import { getNumericFormat } from '@gitlens/utils/date.js';
import { proTrialLengthInDays, SubscriptionState } from '../../../../constants.subscription.js';
import type { Source } from '../../../../constants.telemetry.js';
import type { Subscription, SubscriptionUpgradeCommandArgs } from '../../../../plus/gk/models/subscription.js';
import {
	getSubscriptionProductPlanName,
	getSubscriptionTimeRemaining,
	isSubscriptionPaid,
	isSubscriptionTrial,
} from '../../../../plus/gk/utils/subscription.utils.js';
import { createCommandLink } from '../../../../system/commands.js';
import type { PromosContext } from '../contexts/promos.js';
import { promosContext } from '../contexts/promos.js';
import '@gitlens/components/components/overlays/popover.js';
import '@gitlens/components/components/overlays/tooltip.js';
import './promo.js';

declare global {
	interface HTMLElementTagNameMap {
		'gl-feature-badge': GlFeatureBadge;
	}

	// interface GlobalEventHandlersEventMap {}
}

@customElement('gl-feature-badge')
export class GlFeatureBadge extends LitElement {
	static override styles = [
		boxSizingBase,
		linkBase,
		css`
			:host {
				/* position: relative; */
				display: inline-block;
				--gl-feature-badge-color: currentcolor;
				--gl-feature-badge-border-color: var(--color-foreground--50);
				--max-width: 40rem;
			}

			a {
				color: var(--color-link);
				text-decoration: underline;
			}

			.badge {
				display: inline-block;
				padding: 0 0.8rem 0.1rem;
				font-size: var(--gl-feature-badge-font-size, x-small);
				font-weight: 600;
				font-variant: all-small-caps;
				color: var(--gl-feature-badge-color, currentColor);
				white-space: nowrap;
				cursor: help;
				border: var(--gl-border-width) solid var(--gl-feature-badge-border-color, var(--color-foreground--50));
				border-radius: 1rem;
			}

			.badge:focus-visible {
				${unsafeCSS(focusOutline)}
			}

			.badge-icon {
				margin-left: var(--gl-space-4);
				font-weight: 400;
				white-space: nowrap;
			}

			.badge-popup {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-6);
				white-space: normal;
			}

			.popup-header {
				display: flex;
				flex-direction: column;
				margin-bottom: var(--gl-space-4);
			}

			.popup-title {
				font-size: var(--gl-font-base);
				font-weight: 600;
			}

			.popup-subtitle {
				margin-top: var(--gl-space-6);
				font-size: smaller;
			}

			.popup-content {
				display: flex;
				flex-direction: column;
				padding-top: var(--gl-space-6);
				border-top: var(--gl-border-width) solid var(--color-foreground--25);
			}

			.popup-content p {
				margin: 0;
			}

			.popup-content .actions {
				margin-top: var(--gl-space-8);
				margin-bottom: var(--gl-space-6);
			}

			.popup-content .actions:first-child {
				margin-bottom: var(--gl-space-8);
			}

			.popup-content .actions :not(:first-child) {
				margin-top: var(--gl-space-4);
			}

			.popup-content .actions gl-button:not(:first-child) {
				margin-top: var(--gl-space-8);
			}

			.hint {
				border-bottom: var(--gl-border-width) dashed currentcolor;
			}
		`,
	];

	@property({ type: Boolean })
	cloud: boolean = false;

	@property({ reflect: true })
	placement: GlPopover['placement'] = 'bottom';

	@property({ type: Boolean })
	preview: boolean = false;

	@consume({ context: promosContext })
	private promos!: PromosContext;

	@property({ type: Object })
	source?: Source;

	@property({ attribute: false })
	subscription?: Subscription;

	private get daysRemaining() {
		if (this.subscription == null) return 0;

		return getSubscriptionTimeRemaining(this.subscription, 'days') ?? 0;
	}

	private get state() {
		return this.subscription?.state;
	}

	override render(): unknown {
		return html`
			<gl-popover placement=${this.placement}>
				<span slot="anchor" class="badge" tabindex="0">${this.renderBadge()}</span>
				<div slot="content" class="badge-popup" tabindex="-1">
					${this.renderPopoverHeader()}${this.renderPopoverContent()}
				</div>
			</gl-popover>
		`;
	}

	private renderBadge() {
		const text = this.preview ? l10n.t('Preview') : 'Pro';

		if (this.subscription != null) {
			if (this.state === SubscriptionState.VerificationRequired) {
				return html`${text} <code-icon class="badge-icon" icon="warning" size="10"></code-icon>`;
			} else if (isSubscriptionPaid(this.subscription) || (this.cloud && this.subscription.account != null)) {
				return html`${text} <code-icon class="badge-icon" icon="check" size="10"></code-icon>`;
			} else if (isSubscriptionTrial(this.subscription)) {
				return html`${text} <code-icon class="badge-icon" icon="clock" size="10"></code-icon>`;
			}
		}

		return text;
	}

	private renderPopoverHeader() {
		const text = html`<span class="popup-title"
			>${this.preview ? l10n.t('Preview feature') : l10n.t('Pro feature')}</span
		>`;

		if (this.state === SubscriptionState.Paid) {
			return html`<div class="popup-header">${text}</div>`;
		}

		if (this.cloud) {
			if (this.preview) {
				return html`<div class="popup-header">
					${text}<span class="popup-subtitle"
						>${l10n.t('Unlock this feature with an account and may require GitLens Pro in the future')}</span
					>
				</div>`;
			}

			return html`<div class="popup-header">
				${text}<span class="popup-subtitle"> ${l10n.t('Unlock this feature with GitLens Pro')}</span>
			</div>`;
		}

		if (this.preview) {
			return html`<div class="popup-header">
				${text}<span class="popup-subtitle">${l10n.t('May require GitLens Pro in the future')}</span>
			</div>`;
		}

		return html`<div class="popup-header">
			${text}<span class="popup-subtitle">
				${l10n.t('Unlock this feature for privately hosted repos with GitLens Pro')}</span
			>
		</div>`;
	}

	private renderPopoverContent() {
		if (this.subscription == null) return nothing;

		let content;
		switch (this.state) {
			case SubscriptionState.Paid:
				content = html`<p>
					${localizedContent(l10n.t('Your {plan} plan provides access to all Pro features.'), { plan: html`<gl-tooltip content=${l10n.t('Show Account view')}><a href=${createCommandLink('gitlens.showAccountView')}>${getSubscriptionProductPlanName(this.subscription?.plan.actual.id ?? 'pro')}</a></gl-tooltip>` })}
				</p>`;
				break;

			case SubscriptionState.VerificationRequired:
				content = html`<p>${l10n.t('You must verify your email before you can access Pro features.')}</p>
					<div class="actions">
						<gl-button
							density="tight"
							href="${createCommandLink<Source>('gitlens.plus.resendVerification', this.source)}"
							>${l10n.t('Resend Email')}</gl-button
						>
						<gl-button
							appearance="secondary"
							density="tight"
							href="${createCommandLink<Source>('gitlens.plus.validate', this.source)}"
							><code-icon icon="refresh"></code-icon
						></gl-button>
					</div>`;
				break;

			case SubscriptionState.Trial: {
				const days = this.daysRemaining;

				content = html`<p>
						${localizedContent(
							days < 1
								? l10n.t(
										'You have {count} day left in your Pro trial. Once your trial ends, you will only be able to use Pro features on publicly-hosted repos.',
									)
								: days === 1
									? l10n.t(
											'You have {count} more day left in your Pro trial. Once your trial ends, you will only be able to use Pro features on publicly-hosted repos.',
										)
									: l10n.t(
											'You have {count} more days left in your Pro trial. Once your trial ends, you will only be able to use Pro features on publicly-hosted repos.',
										),
							{ count: html`<strong>${days < 1 ? '<1' : getNumericFormat()(days)}</strong>` },
						)}
					</p>
					${this.renderUpgradeActions()}`;
				break;
			}

			case SubscriptionState.TrialExpired:
				content = html`<p>
						${l10n.t('Your Pro trial has ended. You can now only use Pro features on publicly-hosted repos.')}
					</p>
					${this.renderUpgradeActions(
						html`<p>${l10n.t('Please upgrade for full access to all GitLens Pro features:')}</p>`,
					)}`;
				break;

			case SubscriptionState.TrialReactivationEligible:
				content = html`<p>
						${l10n.t('Reactivate your Pro trial and experience all the new Pro features — free for another {0} days!', getNumericFormat()(proTrialLengthInDays))}
					</p>
					<div class="actions center">
						<gl-button
							density="tight"
							href="${createCommandLink<Source>('gitlens.plus.reactivateProTrial', this.source)}"
							tooltip=${l10n.t('Reactivate your Pro trial for another {0} days', getNumericFormat()(proTrialLengthInDays))}
							>${l10n.t('Reactivate Pro Trial')}</gl-button
						>
					</div>`;
				break;

			default:
				content = html`<p>
						${localizedContent(l10n.t('You only have access to {localFeatures} on publicly-hosted repos.'), { localFeatures: html`<gl-tooltip content=${l10n.t('Pro features that do not require an account')}><span class="hint">${l10n.t('local Pro features')}</span></gl-tooltip>` })}
					</p>
					${this.renderStartTrialActions()}`;
				break;
		}

		return html`<div class="popup-content">${content}</div>`;
	}

	private renderStartTrialActions() {
		return html`<div class="actions">
			<p>${l10n.t('For access to all Pro features:')}</p>
			${localizedContent(l10n.t('{startTrial} or {signIn}'), {
				startTrial: html`<gl-button
					density="tight"
					href="${createCommandLink<Source>('gitlens.plus.signUp', this.source)}"
					>${l10n.t('Start {0}-day Pro Trial', proTrialLengthInDays)}</gl-button
				>`,
				signIn: html`<a
					href="${createCommandLink<Source>('gitlens.plus.login', this.source)}"
					title=${l10n.t('Sign In')}
					>${l10n.t('sign in')}</a
				>`,
			})}
		</div>`;
	}

	private renderUpgradeActions(leadin?: TemplateResult) {
		return html`<div class="actions">
			${leadin ?? nothing}
			<gl-button
				density="tight"
				href="${createCommandLink<SubscriptionUpgradeCommandArgs>('gitlens.plus.upgrade', {
					plan: 'pro',
					...(this.source ?? { source: 'feature-badge' }),
				})}"
				>${l10n.t('Upgrade to Pro')}</gl-button
			>
			${this.renderPromo()}
		</div>`;
	}

	private renderPromo() {
		return html`<gl-promo
			.promoPromise=${this.promos.getApplicablePromo(undefined, 'badge')}
			.source=${this.source}
		></gl-promo>`;
	}
}
