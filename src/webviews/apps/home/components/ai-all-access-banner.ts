import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import { compareSubscriptionPlans } from '../../../../plus/gk/utils/subscription.utils.js';
import { createCommandLink } from '../../../../system/commands.js';
import type { OnboardingState } from '../../shared/contexts/onboarding.js';
import { onboardingContext } from '../../shared/contexts/onboarding.js';
import type { SubscriptionContextState } from '../../shared/contexts/subscription.js';
import { subscriptionContext } from '../../shared/contexts/subscription.js';
import '../../shared/components/banner/banner.js';

export const aiAllAccessBannerTagName = 'gl-ai-all-access-banner';

@customElement(aiAllAccessBannerTagName)
export class GlAiAllAccessBanner extends SignalWatcher(LitElement) {
	@consume({ context: subscriptionContext, subscribe: true })
	private _subscription!: SubscriptionContextState;

	@consume({ context: onboardingContext })
	private _onboarding!: OnboardingState;

	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = [
		css`
			:host {
				display: block;
			}

			gl-banner {
				margin-bottom: 1.2rem;
			}
		`,
	];

	private get shouldShow(): boolean {
		return !this._onboarding.banners.aiAllAccessBanner;
	}

	private get bodyLabel(): string {
		return this.hasAdvancedOrHigher
			? 'Opt in now to get unlimited GitKraken AI until July 11th!'
			: 'Opt in now to try all Advanced GitLens features with unlimited GitKraken AI for FREE until July 11th!';
	}

	private get primaryButtonLabel(): string {
		return 'Opt In Now';
	}

	private get hasAdvancedOrHigher(): boolean {
		const sub = this._subscription.subscription.get();
		return (
			(sub?.plan != null && compareSubscriptionPlans(sub.plan.actual.id, 'advanced') >= 0) ||
			(sub?.plan != null && compareSubscriptionPlans(sub.plan.effective.id, 'advanced') >= 0)
		);
	}

	override render(): unknown {
		if (!this.shouldShow) {
			return nothing;
		}

		return html`
			<gl-banner
				display="gradient"
				banner-title="All Access Week - now until July 11th!"
				body="${this.bodyLabel}"
				primary-button="${this.primaryButtonLabel}"
				primary-button-href="${createCommandLink('gitlens.plus.aiAllAccess.optIn', { source: 'home' })}"
				secondary-button="Dismiss"
				@gl-banner-secondary-click=${this.onSecondaryClick}
			></gl-banner>
		`;
	}

	private onSecondaryClick() {
		this._onboarding.dismiss('aiAllAccessBanner');
	}
}
