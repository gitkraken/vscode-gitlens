import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import type {
	ConnectCloudIntegrationsCommandArgs,
	ManageCloudIntegrationsCommandArgs,
} from '../../../../../commands/cloudIntegrations';
import type { IntegrationFeatures } from '../../../../../constants.integrations';
import { SubscriptionPlanId, SubscriptionState } from '../../../../../constants.subscription';
import type { Source } from '../../../../../constants.telemetry';
import type { SubscriptionUpgradeCommandArgs } from '../../../../../plus/gk/models/subscription';
import {
	hasAccountFromSubscriptionState,
	isSubscriptionStatePaidOrTrial,
} from '../../../../../plus/gk/utils/subscription.utils';
import { createCommandLink } from '../../../../../system/commands';
import type { IntegrationState, State } from '../../../../home/protocol';
import { stateContext } from '../../../home/context';
import { elementBase, linkBase } from '../../../shared/components/styles/lit/base.css';
import { chipStyles } from './chipStyles';
import '../../../shared/components/button';
import '../../../shared/components/button-container';
import '../../../shared/components/code-icon';
import '../../../shared/components/overlays/popover';
import '../../../shared/components/overlays/tooltip';
import '../../../shared/components/feature-badge';

@customElement('gl-integrations-chip')
export class GlIntegrationsChip extends LitElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = [
		elementBase,
		linkBase,
		chipStyles,
		css`
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
				align-items: flex-start;
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
		`,
	];

	@query('#chip')
	private _chip!: HTMLElement;

	@consume<State>({ context: stateContext, subscribe: true })
	@state()
	private _state!: State;

	private get hasAccount() {
		return hasAccountFromSubscriptionState(this._state.subscription?.state);
	}

	private get isPaidAccount() {
		return this._state.subscription?.state === SubscriptionState.Paid;
	}

	private get isProAccount() {
		return isSubscriptionStatePaidOrTrial(this._state.subscription?.state);
	}

	private get hasConnectedIntegrations() {
		return this.hasAccount && this.integrations.some(i => i.connected);
	}

	private get ai() {
		return this._state.ai;
	}

	private get aiEnabled() {
		return this._state.orgSettings?.ai ?? true;
	}

	private get integrations() {
		return this._state.integrations;
	}

	override focus(): void {
		this._chip.focus();
	}

	override render(): unknown {
		const anyConnected = this.hasConnectedIntegrations;
		const statusFilter = createStatusIconFilter(this.integrations);

		return html`<gl-popover placement="bottom" trigger="hover click focus" hoist>
			<span slot="anchor" class="chip" tabindex="0"
				>${!anyConnected ? html`<span class="chip__label">Connect</span>` : ''}${this.integrations
					.filter(statusFilter)
					.map(i => this.renderIntegrationStatus(i))}${this.renderAIStatus()}</span
			>
			<div slot="content" class="content">
				<div class="header">
					<span class="header__title">Integrations</span>
					<span class="header__actions"></span>
						<gl-button
							appearance="toolbar"
							href="${createCommandLink<Source>('gitlens.views.home.account.resync', {
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
												integrationIds: this.integrations.map(i => i.id),
												source: { source: 'home', detail: 'integrations' },
											},
										)}"
										>Connect Integrations</gl-button
									>
								</button-container>`
						: this.integrations.map(i => this.renderIntegrationRow(i))
				}${this.renderAIRow()}</div>
			</div>
		</gl-popover>`;
	}

	private renderIntegrationStatus(integration: IntegrationState) {
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

	private renderIntegrationRow(integration: IntegrationState) {
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
								plan: SubscriptionPlanId.Pro,
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
										integrationIds: [integration.id],
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
		return html`<span
			class="integration status--${this.aiEnabled && this.ai?.model != null ? 'connected' : 'disconnected'}"
			slot="anchor"
		>
			<code-icon icon="${this.aiEnabled && this.ai?.model != null ? 'sparkle-filled' : 'sparkle'}"></code-icon>
		</span>`;
	}

	private renderAIRow() {
		const { model } = this.ai;

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
							<span class="integration__title">
								<span>${model?.provider.name ?? 'AI'}</span>
								${showProBadge
									? html` <gl-feature-badge
											placement="right"
											.source=${{ source: 'home', detail: 'integrations' } as const}
											cloud
									  ></gl-feature-badge>`
									: nothing}
							</span>
							${model?.name ? html`<span class="integration__details">${model.name}</span>` : nothing}
						</span>
						<span class="integration__actions">
							<gl-button
								appearance="toolbar"
								href="${createCommandLink<Source>('gitlens.switchAIModel', {
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
							>GitLens AI features have been disabled by your GitKraken admin</span
						>
				  </span>`}
		</div>`;
	}
}

const featureMap = new Map<IntegrationFeatures, string>([
	['prs', 'pull requests'],
	['issues', 'issues'],
]);

function getIntegrationDetails(integration: IntegrationState): string {
	const features = integration.supports.map(feature => featureMap.get(feature)!);

	if (features.length === 0) return '';
	if (features.length === 1) return `Supports ${features[0]}`;

	const last = features.pop();
	return `Supports ${features.join(', ')}, and ${last}`;
}

function createStatusIconFilter(integrations: IntegrationState[]) {
	const groupedIconMap = new Map<string, IntegrationState>();

	// Group the integrations by icon, and if one is connected
	for (const integration of integrations) {
		const existing = groupedIconMap.get(integration.icon);
		if (!existing || (integration.connected && !existing.connected)) {
			groupedIconMap.set(integration.icon, integration);
		}
	}

	return (integration: IntegrationState) => groupedIconMap.get(integration.icon) === integration;
}
