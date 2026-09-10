import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import * as l10n from '@vscode/l10n';
import { css, html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { boxSizingBase } from '@gitlens/components/components/styles/lit/base.css.js';
import type { IntegrationStateInfo } from '../../../../../rpc/services/types.js';
import type { IntegrationsState } from '../../../../shared/contexts/integrations.js';
import { integrationsContext } from '../../../../shared/contexts/integrations.js';
import type { SubscriptionContextState } from '../../../../shared/contexts/subscription.js';
import { subscriptionContext } from '../../../../shared/contexts/subscription.js';
import { rollupSurfaceStyles, skeletonStyles } from '../../../shared/components/rollupSurface.css.js';
import '@gitlens/components/components/codeIcon.js';

@customElement('gl-integrations-chip')
export class GlIntegrationsChip extends SignalWatcher(LitElement) {
	@consume({ context: subscriptionContext, subscribe: true })
	private _subscription!: SubscriptionContextState;

	@consume({ context: integrationsContext })
	private _integrations!: IntegrationsState;

	static override styles = [
		boxSizingBase,
		rollupSurfaceStyles,
		skeletonStyles,
		css`
			:host {
				display: block;
			}

			/* Baseline, not center: the row mixes the uppercase "Connect" label with the provider
  glyphs, and centering the two makes the text ride high against them. */
			.icons {
				display: flex;
				gap: var(--gl-space-6);
				align-items: baseline;
			}

			.chip__label {
				margin-right: var(--gl-space-4);
				font-size: var(--gl-font-sm);
				font-weight: 400;
				color: var(--color-foreground--75);
				text-transform: uppercase;
			}

			.integration {
				white-space: nowrap;
			}

			.status--disconnected.integration {
				color: var(--color-foreground--25);
			}

			/* The pill; the shimmer that sweeps it is shared (skeletonStyles), which is also why
  position/overflow stay here — they are what the shared ::before positions against.

  display and border-radius are set here rather than inherited: the skeleton used to ride on
  the shared .chip class for both, and a bare inline span would drop the width/height entirely. */
			.skeleton {
				position: relative;
				display: block;
				width: 9rem;
				height: 2.2rem;
				overflow: hidden;
				cursor: default;
				background-color: var(--gl-rollup-raised);
				border-radius: var(--gl-radius-sm);
			}
		`,
	];

	private get hasAccount() {
		return this._subscription.subscription.get()?.account != null;
	}

	private get hasConnectedIntegrations() {
		return this.hasAccount && this.integrations.some(i => i.connected);
	}

	private get integrations() {
		return this._integrations.integrations.get();
	}

	override render(): unknown {
		// Don't show integration state until subscription data has loaded —
		// otherwise we'd flash "Connect" with an empty list.
		if (this._subscription.subscription.get() === undefined) {
			return html`<span
				class="skeleton"
				aria-label="${l10n.t('Loading integrations status')}"
				role="status"
			></span>`;
		}

		// Plain content container — the host anchor (owned by `gl-graph-account-indicator`) is the
		// interactive/labeled element; this just lays out the icons.
		return html`<span class="icons">${this.renderIntegrationIcons()}</span>`;
	}

	private renderIntegrationIcons(): unknown {
		const anyConnected = this.hasConnectedIntegrations;
		const statusFilter = createStatusIconFilter(this.integrations);

		return html`${!anyConnected ? html`<span class="chip__label">${l10n.t('Connect')}</span>` : ''}${this.integrations
			.filter(statusFilter)
			.map(i => this.renderIntegrationStatus(i))}`;
	}

	/** Pro-gating is NOT reflected here, unlike the Settings integration rows, which force a
	 *  `requiresPro` integration the account can't use to read as disconnected and add a lock action.
	 *  This strip lost its own lock glyph when the chip's popover content was extracted into a panel
	 *  component, and the styles for it went away with the Home view. A `requiresPro` branch outlived
	 *  both, but rendered markup identical to this — so the two surfaces disagree about a lapsed
	 *  account's Pro integrations, and this one shows them as plain connected. */
	private renderIntegrationStatus(integration: IntegrationStateInfo) {
		return html`<span class="integration status--${integration.connected ? 'connected' : 'disconnected'}"
			><code-icon icon="${integration.icon}"></code-icon
		></span>`;
	}
}

function createStatusIconFilter(integrations: IntegrationStateInfo[]) {
	const groupedIconMap = new Map<string, IntegrationStateInfo>();

	// Group the integrations by icon, and if one is connected
	for (const integration of integrations) {
		const existing = groupedIconMap.get(integration.icon);
		if (!existing || (integration.connected && !existing.connected)) {
			groupedIconMap.set(integration.icon, integration);
		}
	}

	return (integration: IntegrationStateInfo) => groupedIconMap.get(integration.icon) === integration;
}
