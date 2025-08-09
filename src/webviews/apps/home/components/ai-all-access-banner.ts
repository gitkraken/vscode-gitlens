import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { compareSubscriptionPlans } from '../../../../plus/gk/utils/subscription.utils';
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
			}

			gl-banner {
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

	private get shouldShow(): boolean {
		// Don't show if dismissed or closed
		return !this._state.aiAllAccessBannerCollapsed;
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
		return (
			(this._state.subscription.plan &&
				compareSubscriptionPlans(this._state.subscription.plan.actual.id, 'advanced') >= 0) ||
			compareSubscriptionPlans(this._state.subscription.plan.effective.id, 'advanced') >= 0
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
		this._ipc.sendCommand(DismissAiAllAccessBannerCommand, undefined);
	}
}
