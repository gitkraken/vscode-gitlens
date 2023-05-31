import { attr, css, customElement, FASTElement, html, observable, volatile, when } from '@microsoft/fast-element';
import type { Subscription } from '../../../../../subscription';
import { getSubscriptionTimeRemaining, SubscriptionState } from '../../../../../subscription';
import { pluralize } from '../../../../../system/string';
import { focusOutline } from '../styles/a11y';
import { elementBase } from '../styles/base';
import '../overlays/pop-over';

const template = html<AccountBadge>`
	<template>
		<span class="badge is-help">
			<span class="repo-access ${x => (x.isPro ? 'is-pro' : '')}">✨</span> ${x => x.label}
		</span>
		${when(x => x.subText != null, html<AccountBadge>`&nbsp;&nbsp;<small>${x => x.subText}</small>`)}
		<pop-over placement="${x => x.placement}" class="badge-popover">
			${x => x.popoverText}
			<br /><br />
			✨ indicates a subscription is required to use this feature on privately hosted repos.
		</pop-over>
	</template>
`;

const styles = css`
	${elementBase}

	:host {
		position: relative;
	}

	:host(:focus) {
		${focusOutline}
	}

	.badge {
		font-size: 1rem;
		font-weight: 700;
		text-transform: uppercase;
		color: var(--color-foreground);
	}
	.badge.is-help {
		cursor: help;
	}

	.badge small {
		font-size: inherit;
		opacity: 0.6;
		font-weight: 400;
	}

	.badge-container {
		position: relative;
	}

	.badge-popover {
		width: max-content;
		right: 0;
		top: 100%;
		text-align: left;
	}

	.badge:not(:hover) ~ .badge-popover {
		display: none;
	}
`;

@customElement({
	name: 'account-badge',
	template: template,
	styles: styles,
})
export class AccountBadge extends FASTElement {
	@attr
	placement = 'top end';

	@observable
	subscription?: Subscription;

	@volatile
	get isPro() {
		if (this.subscription == null) {
			return false;
		}

		return ![
			SubscriptionState.Free,
			SubscriptionState.FreePreviewTrialExpired,
			SubscriptionState.FreePlusTrialExpired,
			SubscriptionState.VerificationRequired,
		].includes(this.subscription.state);
	}

	@volatile
	get isTrial() {
		if (this.subscription == null) {
			return false;
		}

		return [SubscriptionState.FreeInPreviewTrial, SubscriptionState.FreePlusInTrial].includes(
			this.subscription?.state,
		);
	}

	@volatile
	get label() {
		if (this.subscription == null) {
			return 'GitLens Free';
		}

		let label = this.subscription.plan.effective.name;
		switch (this.subscription?.state) {
			case SubscriptionState.Free:
			case SubscriptionState.FreePreviewTrialExpired:
			case SubscriptionState.FreePlusTrialExpired:
				label = 'GitLens Free';
				break;
			case SubscriptionState.FreeInPreviewTrial:
			case SubscriptionState.FreePlusInTrial: {
				label = 'GitLens Pro (Trial)';
				break;
			}
			case SubscriptionState.VerificationRequired:
				label = `${label} (Unverified)`;
				break;
		}

		return label;
	}

	@volatile
	get subText() {
		if (this.isTrial) {
			const days = getSubscriptionTimeRemaining(this.subscription!, 'days') ?? 0;
			return `${days < 1 ? '<1 day' : pluralize('day', days)} left`;
		}
		return undefined;
	}

	@volatile
	get popoverText() {
		return this.isPro
			? 'You have access to all GitLens features on any repo.'
			: 'You have access to ✨ features on local & public repos, and all other GitLens features on any repo.';
	}
}
