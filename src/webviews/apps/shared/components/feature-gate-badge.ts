import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Subscription } from '../../../../subscription';
import {
	getSubscriptionStatePlanName,
	getSubscriptionTimeRemaining,
	isSubscriptionStatePaidOrTrial,
	isSubscriptionStateTrial,
	SubscriptionState,
} from '../../../../subscription';
import '../../plus/shared/components/feature-gate-plus-state';
import { pluralize } from '../../../../system/string';
import { focusOutline } from './styles/lit/a11y.css';
import { elementBase } from './styles/lit/base.css';
import './overlays/pop-over';

@customElement('gk-feature-gate-badge')
export class FeatureGateBadge extends LitElement {
	static override styles = [
		elementBase,
		css`
			:host {
				position: relative;
			}

			:host(:focus) {
				${focusOutline}
			}

			.badge-container {
				position: relative;
			}

			.badge {
				cursor: help;
			}

			.badge.inactive {
				filter: grayscale(100%);
			}

			.badge-popover {
				width: max-content;
				top: 100%;
				text-align: left;
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

			.badge:not(:hover) ~ .badge-popover {
				display: none;
			}

			:host(:not([placement~='end'])) .badge-popover {
				left: 0;
			}

			:host([placement~='end']) .badge-popover {
				right: 0;
			}
		`,
	];

	@property({ reflect: true })
	placement?: `${'top' | 'bottom'} ${'start' | 'end'}` = 'top end';

	@property({ attribute: false })
	subscription?: Subscription;

	override render() {
		const paidOrTrial = isSubscriptionStatePaidOrTrial(this.subscription?.state);
		const trial = isSubscriptionStateTrial(this.subscription?.state);

		return html`
			<span class="badge-container">
				<span class="badge ${paidOrTrial ? 'active' : 'inactive'}"
					>${trial ? html`<span class="badge-trial">Trial</span>` : ''}✨</span
				>
				<pop-over .placement=${this.placement} class="badge-popover">
					<span slot="heading"
						>${getSubscriptionStatePlanName(
							this.subscription?.state,
							this.subscription?.plan.effective.id,
						)}${this.trialHtml}</span
					>
					${this.footnoteHtml}
				</pop-over>
			</span>
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
