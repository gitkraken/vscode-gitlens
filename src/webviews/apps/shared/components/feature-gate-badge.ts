import { css, html, LitElement, nothing, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Subscription } from '../../../../plus/gk/account/subscription';
import {
	getSubscriptionStatePlanName,
	getSubscriptionTimeRemaining,
	isSubscriptionStatePaidOrTrial,
	isSubscriptionStateTrial,
	SubscriptionState,
} from '../../../../plus/gk/account/subscription';
import { pluralize } from '../../../../system/string';
import { focusOutline } from './styles/lit/a11y.css';
import { elementBase } from './styles/lit/base.css';
import './overlays/tooltip';

@customElement('gk-feature-gate-badge')
export class FeatureGateBadge extends LitElement {
	static override styles = [
		elementBase,
		css`
			:host {
				position: relative;
			}

			:host(:focus) {
				${unsafeCSS(focusOutline)}
			}

			.badge-headline {
				display: block;
				font-weight: 600;
			}

			.badge {
				cursor: help;
			}

			.badge.inactive {
				filter: grayscale(100%);
			}

			.badge-footnote {
				white-space: break-spaces;
			}

			.badge-trial {
				font-size: smaller;
				font-weight: 700;
				margin-right: 0.5rem;
				text-transform: uppercase;
				white-space: nowrap;
			}

			.badge-trial-left {
				font-weight: 400;
				opacity: 0.6;
				margin-left: 1rem;
			}
		`,
	];

	@property({ reflect: true })
	placement?: `${'top' | 'bottom' | 'left' | 'right'}-${'start' | 'end'}` | 'top' | 'bottom' | 'left' | 'right' =
		'top';

	@property({ attribute: false })
	subscription?: Subscription;

	override render() {
		const paidOrTrial = isSubscriptionStatePaidOrTrial(this.subscription?.state);
		const trial = isSubscriptionStateTrial(this.subscription?.state);

		return html`
			<gl-tooltip .placement=${this.placement}>
				<span class="badge ${paidOrTrial ? 'active' : 'inactive'}"
					>${trial ? html`<span class="badge-trial">Trial</span>` : ''}✨</span
				>
				<div slot="content">
					<span class="badge-headline"
						>${getSubscriptionStatePlanName(
							this.subscription?.state,
							this.subscription?.plan.effective.id,
						)}${this.trialHtml}</span
					>
					${this.footnoteHtml}
				</div>
			</gl-tooltip>
		`;
	}

	private get trialHtml() {
		if (!isSubscriptionStateTrial(this.subscription?.state)) return nothing;

		const days = getSubscriptionTimeRemaining(this.subscription!, 'days') ?? 0;
		return html`<span class="badge-trial-left">${days < 1 ? '<1 day' : pluralize('day', days)} left</span>`;
	}

	private get footnoteHtml() {
		switch (this.subscription?.state) {
			case SubscriptionState.VerificationRequired:
			case SubscriptionState.Free:
			case SubscriptionState.FreePreviewTrialExpired:
				return html`<span class="badge-footnote"
					>✨ Requires a trial or paid plan for use on privately hosted repos.</span
				>`;
			case SubscriptionState.FreePlusTrialExpired:
			case SubscriptionState.FreeInPreviewTrial:
			case SubscriptionState.FreePlusInTrial:
			case SubscriptionState.FreePlusTrialReactivationEligible:
				return html`<span class="badge-footnote"
					>✨ Requires a paid plan for use on privately hosted repos.</span
				>`;
			case SubscriptionState.Paid:
				/* prettier-ignore */
				return html`<span class="badge-footnote"
					>You have access to ✨ features on privately hosted repos and ☁️ features based on your plan.</span
				>`;
			default:
				return nothing;
		}
	}
}
