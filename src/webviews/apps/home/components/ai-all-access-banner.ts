import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { SubscriptionState } from '../../../../constants.subscription';
import { createCommandLink } from '../../../../system/commands';
import type { State } from '../../../home/protocol';
import { DismissAiAllAccessBannerCommand } from '../../../home/protocol';
import { ipcContext } from '../../shared/contexts/ipc';
import type { HostIpc } from '../../shared/ipc';
import { stateContext } from '../context';
import '../../shared/components/banner/banner';

export const aiAllAccessBannerTagName = 'gl-ai-all-access-banner';

@customElement(aiAllAccessBannerTagName)
export class GlAiAllAccessBanner extends LitElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = [
		css`
			:host {
				display: block;
				margin-bottom: 1.2rem;
			}
		`,
	];

	@consume<State>({ context: stateContext, subscribe: true })
	@state()
	private _state!: State;

	@consume<HostIpc>({ context: ipcContext, subscribe: true })
	@state()
	private _ipc!: HostIpc;

	@state()
	private closed = false;

	private get shouldShow(): boolean {
		// Show for Community users and expired trial users
		const subscriptionState = this._state.subscription.state;
		const shouldShowForSubscription =
			subscriptionState === SubscriptionState.Community ||
			subscriptionState === SubscriptionState.TrialExpired ||
			subscriptionState === SubscriptionState.TrialReactivationEligible;

		// Don't show if dismissed or closed
		const isDismissed = this._state.aiAllAccessBannerCollapsed || this.closed;

		return shouldShowForSubscription && !isDismissed;
	}

	override render(): unknown {
		if (!this.shouldShow) {
			return nothing;
		}

		return html`
			<gl-banner
				display="gradient"
				banner-title="All Access Week - now until July 11th!"
				body="Join now to try all Advanced GitLens features with unlimited AI tokens for FREE!"
				primary-button="Try Advanced for Free"
				primary-button-href="${createCommandLink(
					'gitlens.plus.aiAllAccess.optIn',
					{ source: 'home' },
				)}"
				secondary-button="Dismiss"
				@gl-banner-secondary-click=${this.onSecondaryClick}
			></gl-banner>
		`;
	}

	private onSecondaryClick() {
		this.closed = true;
		this._ipc.sendCommand(DismissAiAllAccessBannerCommand, undefined);
	}
}
