import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import type { ConnectCloudIntegrationsCommandArgs } from '../../../../commands/cloudIntegrations.js';
import { createCommandLink } from '../../../../system/commands.js';
import type { GlButton } from '../../shared/components/button.js';
import type { IntegrationsState } from '../../shared/contexts/integrations.js';
import { integrationsContext } from '../../shared/contexts/integrations.js';
import type { OnboardingState } from '../../shared/contexts/onboarding.js';
import { onboardingContext } from '../../shared/contexts/onboarding.js';
import '../../shared/components/button.js';
import '../../shared/components/button-container.js';
import '../../shared/components/card/card.js';

export const integrationBannerTagName = 'gl-integration-banner';

@customElement(integrationBannerTagName)
export class GlIntegrationBanner extends SignalWatcher(LitElement) {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = [
		css`
			gl-card::part(base) {
				margin-block-end: 1.2rem;
			}
		`,
	];

	@consume({ context: integrationsContext })
	private _integrations!: IntegrationsState;

	@consume({ context: onboardingContext })
	private _onboarding!: OnboardingState;

	@state()
	private closed = false;

	@query('gl-button')
	private _button!: GlButton;

	override render(): unknown {
		if (
			this.closed ||
			this._integrations.hasAnyIntegrationConnected.get() ||
			this._onboarding.banners.integrationBanner
		) {
			return nothing;
		}

		return html`
			<gl-card>
				<p><strong>GitLens is better with integrations!</strong></p>
				<p>
					Connect hosting services like GitHub and issue trackers like Jira to track progress and take action
					on PRs and issues related to your branches.
				</p>
				<button-container>
					<gl-button
						appearance="secondary"
						href="${createCommandLink<ConnectCloudIntegrationsCommandArgs>(
							'gitlens.plus.cloudIntegrations.connect',
							{ source: { source: 'home' } },
						)}"
						full
						><code-icon icon="plug"></code-icon> Connect Integrations</gl-button
					>
				</button-container>
				<gl-button slot="actions" appearance="toolbar" @click=${() => this.onClose()}
					><code-icon icon="close"></code-icon
				></gl-button>
			</gl-card>
		`;
	}

	private onClose() {
		this.closed = true;

		this._onboarding.dismiss('integrationBanner');
	}

	override focus(): void {
		this._button.focus();
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[integrationBannerTagName]: GlIntegrationBanner;
	}
}
