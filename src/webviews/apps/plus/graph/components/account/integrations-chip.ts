import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import * as l10n from '@vscode/l10n';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { boxSizingBase } from '@gitlens/components/components/styles/lit/base.css.js';
import type { AIState, IntegrationStateInfo } from '../../../../../rpc/services/types.js';
import type { AIContextState } from '../../../../shared/contexts/ai.js';
import { aiContext } from '../../../../shared/contexts/ai.js';
import type { IntegrationsState } from '../../../../shared/contexts/integrations.js';
import { integrationsContext } from '../../../../shared/contexts/integrations.js';
import type { SubscriptionContextState } from '../../../../shared/contexts/subscription.js';
import { subscriptionContext } from '../../../../shared/contexts/subscription.js';
import '@gitlens/components/components/codeIcon.js';

@customElement('gl-integrations-chip')
export class GlIntegrationsChip extends SignalWatcher(LitElement) {
	@consume({ context: subscriptionContext, subscribe: true })
	private _subscription!: SubscriptionContextState;

	@consume({ context: integrationsContext })
	private _integrations!: IntegrationsState;

	@consume({ context: aiContext })
	private _ai!: AIContextState;

	/** `icons` renders the integration providers alone; `ai-icons` the active AI model named in words — so a
	 *  consumer can head them as separate sections. */
	@property({ reflect: true }) display: 'icons' | 'ai-icons' = 'icons';

	static override styles = [
		boxSizingBase,
		css`
			:host {
				display: block;
			}

			/* Baseline, not center: the icons display mixes the uppercase "Connect" label with the
  provider glyphs, and centering the two makes the text ride high against them. */
			.icons {
				display: flex;
				gap: var(--gl-space-6);
				align-items: baseline;
			}

			:host-context(.vscode-dark),
			:host-context(.vscode-high-contrast) {
				--gl-chip-skeleton-bg: color-mix(in lab, var(--vscode-sideBar-background), #fff 10%);
			}

			:host-context(.vscode-light),
			:host-context(.vscode-high-contrast-light) {
				--gl-chip-skeleton-bg: color-mix(in lab, var(--vscode-sideBar-background), #000 7%);
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

			/* Center, not the .icons baseline: this row is one continuous phrase (glyph → model → provider)
	  rather than a label set beside a run of glyphs, and the smaller provider text sitting on a
	  shared baseline would read as a footnote dropped below the model name. */
			.ai {
				display: flex;
				gap: var(--gl-space-6);
				align-items: center;
			}

			.ai__icon {
				flex: none;
			}

			/* Clips rather than wrapping: model ids run long ("claude-sonnet-4-5-20250929") and the popover
	  is width-capped, so a wrap would push the provider name onto its own line. */
			.ai__model {
				overflow: hidden;
				text-overflow: ellipsis;
				color: var(--color-foreground);
				white-space: nowrap;
			}

			/* Pushed to the far end and muted — the provider answers "where does this run", which is
	  secondary to which model is active. */
			.ai__provider {
				flex: none;
				margin-left: auto;
				font-size: var(--gl-font-sm);
				color: var(--color-foreground--50);
				white-space: nowrap;
			}

			.status--disconnected.integration {
				color: var(--color-foreground--25);
			}

			@keyframes shimmer {
				100% {
					transform: translateX(100%);
				}
			}

			/* display and border-radius are set here rather than inherited: the skeleton used to ride on
  the shared .chip class for both, and a bare inline span would drop the width/height entirely. */
			.chip--skeleton {
				position: relative;
				display: block;
				width: 9rem;
				height: 2.2rem;
				overflow: hidden;
				cursor: default;
				background-color: var(--gl-chip-skeleton-bg);
				border-radius: var(--gl-radius-sm);
			}

			.chip--skeleton::before {
				position: absolute;
				inset: 0;
				content: '';
				background-image: linear-gradient(
					to right,
					transparent 0%,
					var(--color-background--lighten-15) 20%,
					var(--color-background--lighten-30) 60%,
					transparent 100%
				);
				transform: translateX(-100%);
				animation: shimmer 2s var(--gl-ease-in-out) infinite;
			}
		`,
	];

	private get hasAccount() {
		return this._subscription.subscription.get()?.account != null;
	}

	private get hasConnectedIntegrations() {
		return this.hasAccount && this.integrations.some(i => i.connected);
	}

	private get ai(): AIState {
		return this._ai.state.get();
	}

	private get aiEnabled(): boolean {
		return this.ai.enabled && this.ai.orgEnabled;
	}

	private get integrations() {
		return this._integrations.integrations.get();
	}

	override render(): unknown {
		// Don't show integration state until subscription data has loaded —
		// otherwise we'd flash "Connect" with an empty list.
		if (this._subscription.subscription.get() === undefined) {
			return html`<span class="chip--skeleton" aria-label="${l10n.t('Loading integrations status')}" role="status"></span>`;
		}

		// Returned unwrapped: the AI row is its own flex container (the provider name is pushed to the far
		// end), which a `.icons` wrapper would reduce to a single shrink-wrapped item.
		if (this.display === 'ai-icons') {
			return this.renderAIStatus();
		}

		return this.renderIconChip(this.renderIntegrationIcons());
	}

	/** Plain content container — the host anchor (owned by `gl-graph-account-indicator`) is the
	 *  interactive/labeled element; this just lays out the icons. */
	private renderIconChip(content: unknown): unknown {
		return html`<span class="icons">${content}</span>`;
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

	/**
	 * The active model named in words. `role="img"` + `aria-label` rather than an `sr-only` summary: the row's
	 * three visible pieces only mean something read together, and as separate text nodes they'd be announced
	 * as two unrelated labels sharing no relationship. `role="img"` makes the row a leaf, so the one label is
	 * all that's announced — an `sr-only` span would need every visible piece individually `aria-hidden` to
	 * avoid announcing the same thing twice, which is more machinery for the same result.
	 */
	private renderAIStatus() {
		const model = this._ai.model.get();
		// Unreachable — the indicator's `aiEmpty` gate swaps in a "Set up AI" CTA — but a half-populated row
		// with no model to name is worse than no row.
		if (!this.aiEnabled || model == null) return nothing;

		return html`<span class="ai" role="img" aria-label="${l10n.t('AI model: {0} via {1}', [
			model.name,
			model.provider.name,
		])}">
			<code-icon class="ai__icon" icon="sparkle-filled" aria-hidden="true"></code-icon>
			<span class="ai__model">${model.name}</span>
			<span class="ai__provider">${model.provider.name}</span>
		</span>`;
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
