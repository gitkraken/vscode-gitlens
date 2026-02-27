import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, query } from 'lit/decorators.js';
import type {
	ConnectCloudIntegrationsCommandArgs,
	ManageCloudIntegrationsCommandArgs,
} from '../../../../../commands/cloudIntegrations.js';
import type { SupportedCloudIntegrationIds } from '../../../../../constants.integrations.js';
import { SubscriptionState } from '../../../../../constants.subscription.js';
import type { Source } from '../../../../../constants.telemetry.js';
import type { SubscriptionUpgradeCommandArgs } from '../../../../../plus/gk/models/subscription.js';
import { isSubscriptionTrialOrPaidFromState } from '../../../../../plus/gk/utils/subscription.utils.js';
import { createCommandLink } from '../../../../../system/commands.js';
import type { AIState, IntegrationStateInfo } from '../../../../rpc/services/types.js';
import { elementBase, linkBase } from '../../../shared/components/styles/lit/base.css.js';
import type { AIContextState } from '../../../shared/contexts/ai.js';
import { aiContext } from '../../../shared/contexts/ai.js';
import type { IntegrationsState } from '../../../shared/contexts/integrations.js';
import { integrationsContext } from '../../../shared/contexts/integrations.js';
import type { SubscriptionContextState } from '../../../shared/contexts/subscription.js';
import { subscriptionContext } from '../../../shared/contexts/subscription.js';
import { chipStyles } from './chipStyles.js';
import '../../../shared/components/button.js';
import '../../../shared/components/button-container.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/overlays/popover.js';
import '../../../shared/components/overlays/tooltip.js';
import '../../../shared/components/feature-badge.js';

@customElement('gl-integrations-chip')
export class GlIntegrationsChip extends SignalWatcher(LitElement) {
	@consume({ context: subscriptionContext, subscribe: true })
	private _subscription!: SubscriptionContextState;

	@consume({ context: integrationsContext })
	private _integrations!: IntegrationsState;

	@consume({ context: aiContext })
	private _ai!: AIContextState;

	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = [
		elementBase,
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
				gap: 0.6rem;
				padding: 0.2rem 0.4rem 0.4rem 0.4rem;
				align-items: baseline;
			}

			.chip__label {
				font-size: 1.1rem;
				font-weight: 400;
				text-transform: uppercase;
				color: var(--color-foreground--75);
				margin-right: 0.4rem;
			}

			.integration {
				white-space: nowrap;
			}

			.content {
				gap: 0.6rem;
			}

			:host-context(.vscode-dark),
			:host-context(.vscode-high-contrast) {
				--status-color--connected: #00dd00;
			}

			:host-context(.vscode-light),
			:host-context(.vscode-high-contrast-light) {
				--status-color--connected: #00aa00;
			}

			.status--disconnected.integration {
				color: var(--color-foreground--25);
			}

			.status--connected:not(.is-locked) .status-indicator {
				color: var(--status-color--connected);
			}

			gl-tooltip.status-indicator {
				margin-right: 0.4rem;
			}

			.integrations {
				display: flex;
				flex-direction: column;
				gap: 0.8rem;
				width: 100%;
			}

			.integration-row {
				display: flex;
				gap: 1rem;
				align-items: center;
			}

			.integration-row--ai {
				border-top: 1px solid var(--color-foreground--25);
				padding-top: 0.6rem;
			}

			.integration-row--mcp {
				padding-top: 0;
			}

			.status--disconnected .integration__icon {
				color: var(--color-foreground--25);
			}

			.integration__content {
				flex: 1 1 auto;
				display: block;
			}

			.integration__title {
				display: flex;
				justify-content: space-between;
			}

			.integration__title gl-feature-badge {
				vertical-align: super;
			}

			.integration__details {
				display: block;
				color: var(--color-foreground--75);
				font-size: 1rem;
			}

			.status--disconnected .integration__title,
			.status--disconnected .integration__details {
				color: var(--color-foreground--50);
			}

			.integration__actions {
				flex: none;
				display: flex;
				gap: 0.2rem;
				flex-direction: row;
				align-items: center;
				justify-content: flex-end;
			}

			button-container {
				margin-bottom: 0.4rem;
				width: 100%;
			}

			p {
				margin: 0;
			}

			gl-popover::part(body) {
				--max-width: 90vw;
			}

			@keyframes shimmer {
				100% {
					transform: translateX(100%);
				}
			}

			.chip--skeleton {
				position: relative;
				overflow: hidden;
				width: 9rem;
				height: 2.2rem;
				background-color: var(--gl-chip-skeleton-bg);
				cursor: default;
			}

			.chip--skeleton::before {
				content: '';
				position: absolute;
				inset: 0;
				background-image: linear-gradient(
					to right,
					transparent 0%,
					var(--color-background--lighten-15) 20%,
					var(--color-background--lighten-30) 60%,
					transparent 100%
				);
				transform: translateX(-100%);
				animation: shimmer 2s ease-in-out infinite;
			}
		`,
	];

	@query('#chip')
	private _chip!: HTMLElement;

	private get hasAccount() {
		return this._subscription.subscription.get()?.account != null;
	}

	private get isPaidAccount() {
		return this._subscription.subscription.get()?.state === SubscriptionState.Paid;
	}

	private get isProAccount() {
		return isSubscriptionTrialOrPaidFromState(this._subscription.subscription.get()?.state);
	}

	private get hasConnectedIntegrations() {
		return this.hasAccount && this.integrations.some(i => i.connected);
	}

	private get ai(): AIState {
		return this._ai.aiState.get();
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

		const anyConnected = this.hasConnectedIntegrations;
		const statusFilter = createStatusIconFilter(this.integrations);

		return html`<gl-popover placement="bottom" trigger="hover click focus" hoist>
			<span slot="anchor" class="chip" tabindex="0"
				>${!anyConnected ? html`<span class="chip__label">Connect</span>` : ''}${this.integrations
					.filter(statusFilter)
					.map(i => this.renderIntegrationStatus(i))}${this.renderAIStatus()}${this.renderMcpStatus()}</span
			>
			<div slot="content" class="content">
				<div class="header">
					<span class="header__title">Integrations</span>
					<span class="header__actions"></span>
						<gl-button
							appearance="toolbar"
							href="${createCommandLink<Source>('gitlens.plus.validate', {
								source: 'home',
								detail: 'integrations',
							})}"
							tooltip="Synchronize Status"
							aria-label="Synchronize Status"
							><code-icon icon="sync"></code-icon
						></gl-button>
						<gl-button
							appearance="toolbar"
							href="${createCommandLink<ManageCloudIntegrationsCommandArgs>('gitlens.plus.cloudIntegrations.manage', {
								source: { source: 'home' },
							})}"
							tooltip="Manage Integrations"
							aria-label="Manage Integrations"
							><code-icon icon="gear"></code-icon></gl-button
					></span>
				</div>
				<div class="integrations">${
					!anyConnected
						? html`<p>
									Connect hosting services like <strong>GitHub</strong> and issue trackers like
									<strong>Jira</strong> to track progress and take action on PRs and issues related to
									your branches.
								</p>
								<button-container>
									<gl-button
										full
										href="${createCommandLink<ConnectCloudIntegrationsCommandArgs>(
											'gitlens.plus.cloudIntegrations.connect',
											{
												integrationIds: this.integrations.map(
													i => i.id as SupportedCloudIntegrationIds,
												),
												source: { source: 'home', detail: 'integrations' },
											},
										)}"
										>Connect Integrations</gl-button
									>
								</button-container>`
						: this.integrations.map(i => this.renderIntegrationRow(i))
				}${this.renderAIRow()}${this.renderMcpRow()}</div>
			</div>
		</gl-popover>`;
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

	private renderIntegrationRow(integration: IntegrationStateInfo) {
		const showLock = integration.requiresPro && !this.isProAccount;
		const showProBadge = integration.requiresPro && !this.isPaidAccount;
		return html`<div
			class="integration-row status--${integration.connected ? 'connected' : 'disconnected'}${showLock
				? ' is-locked'
				: ''}"
		>
			<span class="integration__icon"><code-icon icon="${integration.icon}"></code-icon></span>
			<span class="integration__content">
				<span class="integration__title">
					<span>${integration.name}</span>
					${showProBadge
						? html` <gl-feature-badge
								placement="right"
								.source=${{ source: 'home', detail: 'integrations' } as const}
								cloud
							></gl-feature-badge>`
						: nothing}
				</span>
				<span class="integration__details">${getIntegrationDetails(integration)}</span>
			</span>
			<span class="integration__actions">
				${showLock
					? html`<gl-button
							appearance="toolbar"
							href="${createCommandLink<SubscriptionUpgradeCommandArgs>('gitlens.plus.upgrade', {
								plan: 'pro',
								source: 'home',
								detail: 'integrations',
							})}"
							tooltip="Unlock ${integration.name} features with GitLens Pro"
							aria-label="Unlock ${integration.name} features with GitLens Pro"
							><code-icon class="status-indicator" icon="lock"></code-icon
						></gl-button>`
					: integration.connected
						? html`<gl-tooltip
								class="status-indicator status--connected"
								placement="bottom"
								content="Connected"
								><code-icon class="status-indicator" icon="check"></code-icon
							></gl-tooltip>`
						: html`<gl-button
								appearance="toolbar"
								href="${createCommandLink<ConnectCloudIntegrationsCommandArgs>(
									'gitlens.plus.cloudIntegrations.connect',
									{
										integrationIds: [integration.id as SupportedCloudIntegrationIds],
										source: { source: 'home', detail: 'integrations' },
									},
								)}"
								tooltip="Connect ${integration.name}"
								aria-label="Connect ${integration.name}"
								><code-icon icon="plug"></code-icon
							></gl-button>`}
			</span>
		</div>`;
	}

	private renderAIStatus() {
		const model = this._ai.aiModel.get();
		return html`<span
			class="integration status--${this.aiEnabled && model != null ? 'connected' : 'disconnected'}"
			slot="anchor"
		>
			<code-icon icon="${this.aiEnabled && model != null ? 'sparkle-filled' : 'sparkle'}"></code-icon>
		</span>`;
	}

	private renderAIRow() {
		const model = this._ai.aiModel.get();

		const connectedAndEnabled = this.aiEnabled && model != null;
		const showLock = !this.aiEnabled;
		const showProBadge = false;
		const icon = connectedAndEnabled ? 'sparkle-filled' : 'sparkle'; // TODO: Provider?

		return html`<div
			class="integration-row integration-row--ai status--${connectedAndEnabled
				? 'connected'
				: 'disconnected'}${showLock ? ' is-locked' : ''}"
		>
			<span class="integration__icon"><code-icon icon="${icon}"></code-icon></span>
			${this.aiEnabled
				? html`<span class="integration__content">
							${model?.provider.name
								? html`<span class="integration__title">
										<span>${model.provider.name}</span>
										${showProBadge
											? html` <gl-feature-badge
													placement="right"
													.source=${{ source: 'home', detail: 'integrations' } as const}
													cloud
												></gl-feature-badge>`
											: nothing}
									</span>`
								: html`<span class="integration_details">Select AI model to enable AI features</span>`}
							${model?.name ? html`<span class="integration__details">${model.name}</span>` : nothing}
						</span>
						<span class="integration__actions">
							<gl-button
								appearance="toolbar"
								href="${createCommandLink<Source>('gitlens.ai.switchProvider', {
									source: 'home',
									detail: 'integrations',
								})}"
								tooltip="Switch AI Provider/Model"
								aria-label="Switch AI Provider/Model"
								><code-icon icon="arrow-swap"></code-icon
							></gl-button>
						</span>`
				: html`<span class="integration__content">
							<span class="integration_details"
								>GitLens AI features have been
								disabled${!this.ai.enabled ? ' via settings' : ' by your GitKraken admin'}</span
							>
						</span>
						${!this.ai.enabled
							? html` <span class="integration__actions">
									<gl-button
										appearance="toolbar"
										href="${createCommandLink<Source>('gitlens.ai.enable', {
											source: 'home',
											detail: 'integrations',
										})}"
										tooltip="Re-enable AI Features"
										aria-label="Re-enable AI Features"
										><code-icon icon="unlock"></code-icon
									></gl-button>
								</span>`
							: nothing}`}
		</div>`;
	}

	private renderMcpStatus() {
		const { mcp } = this.ai;
		const active = this.aiEnabled && mcp.settingEnabled && mcp.installed;
		return html`<span class="integration status--${active ? 'connected' : 'disconnected'}" slot="anchor">
			<code-icon icon="mcp"></code-icon>
		</span>`;
	}

	private renderMcpRow() {
		const { mcp } = this.ai;
		const mcpEnabled = this.aiEnabled && mcp.settingEnabled;
		const active = mcpEnabled && mcp.installed;

		return html`<div class="integration-row integration-row--mcp status--${active ? 'connected' : 'disconnected'}">
			<span class="integration__icon"><code-icon icon="mcp"></code-icon></span>
			${mcpEnabled
				? mcp.installed
					? html`<span class="integration__content">
								<span class="integration__title">GitKraken MCP</span>
								<span class="integration__details">Leverage Git &amp; Integrations in AI chats</span>
							</span>
							<span class="integration__actions">
								<gl-button
									appearance="toolbar"
									href="${createCommandLink<Source>('gitlens.ai.mcp.reinstall', {
										source: 'home',
										detail: 'integrations',
									})}"
									tooltip="Reinstall GitKraken MCP"
									aria-label="Reinstall GitKraken MCP"
									><code-icon icon="sync"></code-icon
								></gl-button>
								<gl-tooltip
									class="status-indicator status--connected"
									placement="bottom"
									content="Installed${mcp.bundled ? ' (bundled)' : ''}"
									><code-icon class="status-indicator" icon="check"></code-icon
								></gl-tooltip>
							</span>`
					: html`<span class="integration__content">
								<span class="integration__title">GitKraken MCP</span>
								<span class="integration__details">Leverage Git &amp; Integrations in AI chats</span>
							</span>
							<span class="integration__actions">
								<gl-button
									appearance="toolbar"
									href="${createCommandLink<Source>('gitlens.ai.mcp.install', {
										source: 'home',
										detail: 'integrations',
									})}"
									tooltip="Install GitKraken MCP"
									aria-label="Install GitKraken MCP"
									><code-icon icon="plug"></code-icon
								></gl-button>
							</span>`
				: !this.aiEnabled
					? html`<span class="integration__content">
								<span class="integration_details"
									>GitKraken MCP has been
									disabled${!this.ai.enabled ? ' via settings' : ' by your GitKraken admin'}</span
								>
							</span>
							${!this.ai.enabled
								? html` <span class="integration__actions">
										<gl-button
											appearance="toolbar"
											href="${createCommandLink<Source>('gitlens.ai.enable', {
												source: 'home',
												detail: 'integrations',
											})}"
											tooltip="Re-enable AI Features"
											aria-label="Re-enable AI Features"
											><code-icon icon="unlock"></code-icon
										></gl-button>
									</span>`
								: nothing}`
					: html`<span class="integration__content">
								<span class="integration_details">GitKraken MCP has been disabled via settings</span>
							</span>
							<span class="integration__actions">
								<gl-button
									appearance="toolbar"
									href="${createCommandLink<Source>('gitlens.ai.mcp.install', {
										source: 'home',
										detail: 'integrations',
									})}"
									tooltip="Re-enable MCP"
									aria-label="Re-enable MCP"
									><code-icon icon="unlock"></code-icon
								></gl-button>
							</span>`}
		</div>`;
	}
}

const featureMap = new Map<string, string>([
	['prs', 'pull requests'],
	['issues', 'issues'],
]);

function getIntegrationDetails(integration: IntegrationStateInfo): string {
	const features = integration.supports.map(feature => featureMap.get(feature)!);

	if (features.length === 0) return '';
	if (features.length === 1) return `Supports ${features[0]}`;

	const last = features.pop();
	return `Supports ${features.join(', ')}, and ${last}`;
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
