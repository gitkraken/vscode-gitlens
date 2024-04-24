import { css, html, LitElement, nothing, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Subscription } from '../../../../plus/gk/account/subscription';
import {
	getSubscriptionStatePlanName,
	getSubscriptionTimeRemaining,
	isSubscriptionStateTrial,
	SubscriptionState,
} from '../../../../plus/gk/account/subscription';
import { pluralize } from '../../../../system/string';
import type { GlTooltip } from './overlays/tooltip';
import { focusOutline } from './styles/lit/a11y.css';
import { elementBase } from './styles/lit/base.css';
import './overlays/tooltip';

@customElement('gl-feature-badge')
export class GlFeatureBadge extends LitElement {
	static override styles = [
		elementBase,
		css`
			:host {
				position: relative;
			}

			:host(:focus) {
				${unsafeCSS(focusOutline)}
			}

			.badge {
				cursor: help;
				display: flex;
				font-size: var(--gl-feature-badge-font-size, x-small);
				font-variant: all-small-caps;
				font-weight: 600;
				border: var(--color-foreground--50) 1px solid;
				border-radius: 1rem;
				padding: 0 0.8rem 0.1rem 0.8rem;
				white-space: nowrap;
			}

			.badge-headline {
				display: block;
				font-weight: 600;
			}

			.badge-content {
				white-space: break-spaces;
			}

			.badge-subtext {
				font-weight: 400;
				margin-left: 0.4rem;
				white-space: nowrap;
			}

			.badge-trial-left {
				font-weight: 400;
				opacity: 0.6;
				margin-left: 1rem;
			}

			hr {
				border: none;
				border-top: 1px solid var(--color-foreground--25);
			}
		`,
	];

	@property({ type: Boolean })
	cloud: boolean = false;

	@property({ reflect: true })
	placement?: GlTooltip['placement'] = 'top';

	@property({ type: Boolean })
	preview: boolean = false;

	@property({ attribute: false })
	subscription?: Subscription;

	override render() {
		return html`
			<gl-tooltip placement=${this.placement}>
				<span class="badge">Pro${this.subtextHtml}</span>
				<div slot="content">${this.contentHtml}${this.subscriptionHtml}</div>
			</gl-tooltip>
		`;
	}

	private get contentHtml() {
		if (this.preview) {
			return html`<span class="badge-content"
				>Preview feature &mdash; may require a paid plan in the future</span
			>`;
		}

		switch (this.subscription?.state) {
			case SubscriptionState.Paid:
				return html`<span class="badge-content">Pro feature &mdash; you have access to all Pro features</span>`;
			case SubscriptionState.VerificationRequired:
			case SubscriptionState.Free:
			case SubscriptionState.FreePreviewTrialExpired:
				if (this.cloud) {
					return html`<span class="badge-content">Pro feature &mdash; requires a trial or paid plan</span>`;
				}
				return html`<span class="badge-content"
					>Pro feature &mdash; requires a trial or paid plan for use on privately hosted repos</span
				>`;
			case SubscriptionState.FreePlusTrialExpired:
			case SubscriptionState.FreeInPreviewTrial:
			case SubscriptionState.FreePlusInTrial:
			case SubscriptionState.FreePlusTrialReactivationEligible:
				if (this.cloud) {
					return html`<span class="badge-content">Pro feature &mdash; requires a paid plan</span>`;
				}
				return html`<span class="badge-content"
					>Pro feature &mdash; requires a paid plan for use on privately hosted repos</span
				>`;
			default:
				if (this.cloud) {
					return html`<span class="badge-content">Pro feature &mdash; requires a trial or paid plan</span>`;
				}
				return html`<span class="badge-content"
					>Pro feature &mdash; requires a trial or paid plan for use on privately hosted repos</span
				>`;
		}
	}

	private get subscriptionHtml() {
		if (this.subscription == null) return nothing;

		return html`
			<span class="badge-headline"
				><hr />
				Your plan:
				${getSubscriptionStatePlanName(this.subscription?.state, this.subscription?.plan.effective.id)}${this
					.trialHtml}</span
			>
		`;
	}

	private get subtextHtml() {
		if (this.preview) {
			return html`<span class="badge-subtext"> Preview</span>`;
		}

		if (isSubscriptionStateTrial(this.subscription?.state)) {
			return html`<span class="badge-subtext"> Trial</span>`;
		}

		return nothing;
	}

	private get trialHtml() {
		if (!isSubscriptionStateTrial(this.subscription?.state)) return nothing;

		const days = getSubscriptionTimeRemaining(this.subscription!, 'days') ?? 0;
		return html`<span class="badge-trial-left">${days < 1 ? '<1 day' : pluralize('day', days)} left</span>`;
	}
}
