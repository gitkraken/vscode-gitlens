import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { SupportedCloudIntegrationIds } from '@gitlens/integrations/constants.js';
import type {
	ConnectCloudIntegrationsCommandArgs,
	ManageCloudIntegrationsCommandArgs,
} from '../../../../../commands/cloudIntegrations.js';
import { SubscriptionState } from '../../../../../constants.subscription.js';
import type { Source } from '../../../../../constants.telemetry.js';
import type { SubscriptionUpgradeCommandArgs } from '../../../../../plus/gk/models/subscription.js';
import { isSubscriptionTrialOrPaidFromState } from '../../../../../plus/gk/utils/subscription.utils.js';
import { createCommandLink } from '../../../../../system/commands.js';
import type { IntegrationStateInfo } from '../../../../rpc/services/types.js';
import { focusableBaseStyles } from '../../../shared/components/styles/lit/a11y.css.js';
import { boxSizingBase, linkBase } from '../../../shared/components/styles/lit/base.css.js';
import type { IntegrationsState } from '../../../shared/contexts/integrations.js';
import { integrationsContext } from '../../../shared/contexts/integrations.js';
import type { SubscriptionContextState } from '../../../shared/contexts/subscription.js';
import { subscriptionContext } from '../../../shared/contexts/subscription.js';
import { chipStyles } from './chipStyles.js';
import { integrationRowStyles } from './integrationRowStyles.js';
import '../../../shared/components/button.js';
import '../../../shared/components/button-container.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/overlays/tooltip.js';
import '../../../shared/components/feature-badge.js';

declare global {
	interface HTMLElementTagNameMap {
		'gl-integrations-panel': GlIntegrationsPanel;
	}
}

/**
 * The full Integrations panel — a header with sync/manage actions plus a per-integration connection
 * row for each supported cloud integration, or a "Connect Integrations" CTA when none are connected.
 * Used by the graph account modal and composed by `gl-integrations-chip`'s popover.
 */
@customElement('gl-integrations-panel')
export class GlIntegrationsPanel extends SignalWatcher(LitElement) {
	@consume({ context: subscriptionContext, subscribe: true })
	private _subscription!: SubscriptionContextState;

	@consume({ context: integrationsContext })
	private _integrations!: IntegrationsState;

	static override styles = [
		boxSizingBase,
		focusableBaseStyles,
		linkBase,
		chipStyles,
		integrationRowStyles,
		css`
			:host {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-4);
				width: 100%;
			}

			button-container {
				width: 100%;
				margin-bottom: var(--gl-space-4);
			}

			p {
				margin: 0;
			}
		`,
	];

	@state()
	private listAllIntegrations = false;

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

	private get integrations() {
		return this._integrations.integrations.get();
	}

	override render(): unknown {
		// Don't show integration state until subscription data has loaded —
		// otherwise we'd flash "Connect" with an empty list.
		if (this._subscription.subscription.get() === undefined) return nothing;

		return html`<div class="header">
				<span class="header__title">Integrations</span>
				<span class="header__actions">
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
						href="${createCommandLink<ManageCloudIntegrationsCommandArgs>(
							'gitlens.plus.cloudIntegrations.manage',
							{
								source: { source: 'home' },
							},
						)}"
						tooltip="Manage Integrations"
						aria-label="Manage Integrations"
						><code-icon icon="gear"></code-icon
					></gl-button>
				</span>
			</div>
			<div class="integrations">${this.renderIntegrationList()}</div>`;
	}

	private renderIntegrationList() {
		const anyConnected = this.hasConnectedIntegrations;
		if (!anyConnected) {
			return html`<p>
					Connect hosting services like <strong>GitHub</strong> and issue trackers like
					<strong>Jira</strong> to track progress and take action on PRs and issues related to your branches.
				</p>
				<button-container>
					<gl-button
						full
						href="${createCommandLink<ConnectCloudIntegrationsCommandArgs>(
							'gitlens.plus.cloudIntegrations.connect',
							{
								integrationIds: this.integrations.map(i => i.id as SupportedCloudIntegrationIds),
								source: { source: 'home', detail: 'integrations' },
							},
						)}"
						>Connect Integrations</gl-button
					>
				</button-container>`;
		}

		let integrationsList = this.integrations;
		if (!this.listAllIntegrations) {
			integrationsList = this.integrations.filter(i => i.connected);
		}

		return html`
			<div class="integration-toggle">
				<button
					@click=${() => {
						this.listAllIntegrations = !this.listAllIntegrations;
					}}
				>
					Show:
					${when(
						this.listAllIntegrations,
						() => html`<strong>All</strong> | <span>Connected</span>`,
						() => html`<span>All</span> | <strong>Connected</strong>`,
					)}
				</button>
			</div>
			${integrationsList.map(i => this.renderIntegrationRow(i))}
		`;
	}

	private renderIntegrationRow(integration: IntegrationStateInfo) {
		const showLock = integration.requiresPro && !this.isProAccount;
		const showProBadge = integration.requiresPro && !this.isPaidAccount;
		return html`<div
			class="integration-row status--${integration.connected ? 'connected' : 'disconnected'}${
				showLock ? ' is-locked' : ''
			}"
		>
			<span class="integration__icon"><code-icon icon="${integration.icon}"></code-icon></span>
			<span class="integration__content">
				<span class="integration__title">
					<span>${integration.name}</span>
					${
						showProBadge
							? html` <gl-feature-badge
									placement="right"
									.source=${{ source: 'home', detail: 'integrations' } as const}
									cloud
								></gl-feature-badge>`
							: nothing
					}
				</span>
				<span class="integration__details">${getIntegrationDetails(integration)}</span>
			</span>
			<span class="integration__actions">
				${
					showLock
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
								></gl-button>`
				}
			</span>
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
