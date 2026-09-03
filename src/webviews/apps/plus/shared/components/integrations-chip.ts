import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { focusableBaseStyles } from '@gitlens/components/components/styles/lit/a11y.css.js';
import { boxSizingBase, linkBase } from '@gitlens/components/components/styles/lit/base.css.js';
import { isSubscriptionTrialOrPaidFromState } from '../../../../../plus/gk/utils/subscription.utils.js';
import type { AIState, IntegrationStateInfo } from '../../../../rpc/services/types.js';
import type { AIContextState } from '../../../shared/contexts/ai.js';
import { aiContext } from '../../../shared/contexts/ai.js';
import type { IntegrationsState } from '../../../shared/contexts/integrations.js';
import { integrationsContext } from '../../../shared/contexts/integrations.js';
import type { SubscriptionContextState } from '../../../shared/contexts/subscription.js';
import { subscriptionContext } from '../../../shared/contexts/subscription.js';
import { chipStyles } from './chipStyles.js';
import '@gitlens/components/components/codeIcon.js';

@customElement('gl-integrations-chip')
export class GlIntegrationsChip extends SignalWatcher(LitElement) {
	@consume({ context: subscriptionContext, subscribe: true })
	private _subscription!: SubscriptionContextState;

	@consume({ context: integrationsContext })
	private _integrations!: IntegrationsState;

	@consume({ context: aiContext })
	private _ai!: AIContextState;

	/** `icons` renders the integration providers alone; `ai-icons` the AI model status alone; `agent-icons`
	 *  the MCP / Hooks / Default Agent statuses alone — so a consumer can head them as separate sections. */
	@property({ reflect: true }) display: 'icons' | 'ai-icons' | 'agent-icons' = 'icons';

	/** When set, the `icons`/`ai-icons`/`agent-icons` chip renders as a command link (`<a>`) instead of a
	 *  `<button>`, so clicking it navigates rather than emitting a click for the host to handle. */
	@property() href?: string;

	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = [
		boxSizingBase,
		focusableBaseStyles,
		linkBase,
		chipStyles,
		css`
			:host-context(.vscode-dark),
			:host-context(.vscode-high-contrast) {
				--gl-chip-skeleton-bg: color-mix(in lab, var(--vscode-sideBar-background), #fff 10%);
			}

			:host-context(.vscode-light),
			:host-context(.vscode-high-contrast-light) {
				--gl-chip-skeleton-bg: color-mix(in lab, var(--vscode-sideBar-background), #000 7%);
			}

			.chip {
				gap: var(--gl-space-6);
				align-items: baseline;
				padding: var(--gl-space-2) var(--gl-space-4) var(--gl-space-4);
			}

			button.chip {
				margin: 0;
				font: inherit;
				color: inherit;
				text-align: start;
				appearance: none;
				background: none;
				border: none;
			}

			/* The command-link variant (href) must read like the button chip, not a text link — override
  linkBase's textLink color and hover underline. */
			a.chip,
			a.chip:hover {
				color: inherit;
				text-decoration: none;
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

			@keyframes shimmer {
				100% {
					transform: translateX(100%);
				}
			}

			.chip--skeleton {
				position: relative;
				width: 9rem;
				height: 2.2rem;
				overflow: hidden;
				cursor: default;
				background-color: var(--gl-chip-skeleton-bg);
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

	@query('#chip')
	private _chip!: HTMLElement;

	private get hasAccount() {
		return this._subscription.subscription.get()?.account != null;
	}

	private get isProAccount() {
		return isSubscriptionTrialOrPaidFromState(this._subscription.subscription.get()?.state);
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

	override focus(): void {
		this._chip.focus();
	}

	override render(): unknown {
		// Don't show integration state until subscription data has loaded —
		// otherwise we'd flash "Connect" with an empty list.
		if (this._subscription.subscription.get() === undefined) {
			return html`<span
				id="chip"
				class="chip chip--skeleton"
				tabindex="-1"
				aria-label="Loading integrations status"
				role="status"
			></span>`;
		}

		if (this.display === 'ai-icons') {
			return this.renderIconChip('AI', this.renderAIStatus());
		}

		if (this.display === 'agent-icons') {
			return this.renderIconChip('Agents', this.renderAgentIcons());
		}

		return this.renderIconChip('Integrations', this.renderIntegrationIcons());
	}

	/** Icon-only chip: a command link when `href` is set (navigates on click), else a button whose click
	 *  the host handles. Both keep `id="chip"` so `focus()`/delegatesFocus behave identically. */
	private renderIconChip(ariaLabel: string, content: unknown): unknown {
		if (this.href != null) {
			return html`<a id="chip" class="chip" href=${this.href} aria-label=${ariaLabel}>${content}</a>`;
		}

		return html`<button id="chip" class="chip" type="button" aria-label=${ariaLabel}>${content}</button>`;
	}

	private renderIntegrationIcons(): unknown {
		const anyConnected = this.hasConnectedIntegrations;
		const statusFilter = createStatusIconFilter(this.integrations);

		return html`${!anyConnected ? html`<span class="chip__label">Connect</span>` : ''}${this.integrations
			.filter(statusFilter)
			.map(i => this.renderIntegrationStatus(i))}`;
	}

	private renderAgentIcons(): unknown {
		return html`${this.renderMcpStatus()}${this.renderAgentHooksStatus()}${this.renderDefaultAgentStatus()}`;
	}

	private renderIntegrationStatus(integration: IntegrationStateInfo) {
		if (integration.requiresPro && !this.isProAccount) {
			return html`<span
				class="integration status--${integration.connected ? 'connected' : 'disconnected'} is-locked"
				slot="anchor"
				><code-icon icon="${integration.icon}"></code-icon
			></span>`;
		}

		return html`<span
			class="integration status--${integration.connected ? 'connected' : 'disconnected'}"
			slot="anchor"
			><code-icon icon="${integration.icon}"></code-icon
		></span>`;
	}

	private renderAIStatus() {
		const model = this._ai.model.get();
		return html`<span
			class="integration status--${this.aiEnabled && model != null ? 'connected' : 'disconnected'}"
			slot="anchor"
		>
			<code-icon icon="${this.aiEnabled && model != null ? 'sparkle-filled' : 'sparkle'}"></code-icon>
		</span>`;
	}

	private renderMcpStatus() {
		const { mcp } = this.ai;
		const active = this.aiEnabled && mcp.settingEnabled && mcp.installed;
		return html`<span class="integration status--${active ? 'connected' : 'disconnected'}" slot="anchor">
			<code-icon icon="mcp"></code-icon>
		</span>`;
	}

	private renderDefaultAgentStatus() {
		if (!this.aiEnabled) return nothing;

		const agent = this.ai.defaultAgent;
		return html`<span class="integration status--${agent != null ? 'connected' : 'disconnected'}" slot="anchor">
			<code-icon icon="robot"></code-icon>
		</span>`;
	}

	/** Persistent (always-rendered) hooks status for `agent-icons` — greyed when not installed. */
	private renderAgentHooksStatus() {
		const installed = this.aiEnabled && this.ai.hooks.anyInstalled;
		return html`<span class="integration status--${installed ? 'connected' : 'disconnected'}" slot="anchor">
			<code-icon icon="search-sparkle"></code-icon>
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
