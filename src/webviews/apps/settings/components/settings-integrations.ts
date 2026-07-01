import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { SupportedCloudIntegrationIds } from '@gitlens/integrations/constants.js';
import type {
	ConnectCloudIntegrationsCommandArgs,
	ManageCloudIntegrationsCommandArgs,
} from '../../../../commands/cloudIntegrations.js';
import { SubscriptionState } from '../../../../constants.subscription.js';
import type { Source } from '../../../../constants.telemetry.js';
import type { SubscriptionUpgradeCommandArgs } from '../../../../plus/gk/models/subscription.js';
import { isSubscriptionTrialOrPaidFromState } from '../../../../plus/gk/utils/subscription.utils.js';
import { createCommandLink } from '../../../../system/commands.js';
import type { IntegrationStateInfo } from '../../../rpc/services/types.js';
import { boxSizingBase, linkBase } from '../../shared/components/styles/lit/base.css.js';
import type { SettingsActions } from '../actions.js';
import type { SettingsState } from '../state.js';
import { settingsStateContext } from '../state.js';
import '../../shared/components/button.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/feature-badge.js';
import '../../shared/components/skeleton-loader.js';

declare global {
	interface HTMLElementTagNameMap {
		['gl-settings-integrations']: GlSettingsIntegrations;
	}
}

/**
 * The cloud-integrations connection panel — one row per supported integration
 * with its connection state, mirroring the Home view's integrations chip.
 *
 * These aren't config settings: state comes from the shared integrations and
 * subscription RPC services, and all actions run commands (connect, upgrade,
 * synchronize, manage).
 */
@customElement('gl-settings-integrations')
export class GlSettingsIntegrations extends SignalWatcher(LitElement) {
	static override styles = [
		boxSizingBase,
		linkBase,
		css`
			:host {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-12);

				/* Semantic success token so custom/high-contrast themes keep contrast */
				--status-color--connected: var(--vscode-testing-iconPassed, var(--vscode-charts-green));
			}

			.rows {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-8);
				padding: 0;
				margin: 0;
				list-style: none;
			}

			.row {
				display: flex;
				gap: var(--gl-space-10);
				align-items: center;
				padding: 0.9rem 1.1rem;
				border: var(--gl-border-width) solid var(--vscode-widget-border, var(--color-foreground--25));
				border-radius: var(--gl-radius-md);
			}

			.row__icon {
				flex: none;
				font-size: 1.6rem;
			}

			.row--disconnected .row__icon {
				color: var(--color-foreground--25);
			}

			.row__content {
				flex: 1 1 auto;
				min-width: 0;
			}

			.row__title {
				display: flex;
				gap: var(--gl-space-6);
				align-items: center;
				font-size: 1.25rem;
				color: var(--color-foreground);
			}

			.row__details {
				font-size: 1.1rem;
				color: var(--color-foreground--65);
			}

			.row--disconnected .row__title,
			.row--disconnected .row__details {
				color: var(--color-foreground--50);
			}

			.row__actions {
				display: flex;
				flex: none;
				gap: var(--gl-space-6);
				align-items: center;
			}

			.row__status {
				display: flex;
				gap: 0.5rem;
				align-items: center;
				font-size: 1.15rem;
				color: var(--status-color--connected);
			}

			.panel-actions {
				display: flex;
				gap: var(--gl-space-8);
				align-items: center;
			}

			.error {
				display: flex;
				gap: var(--gl-space-8);
				align-items: center;
				padding: var(--gl-space-10) var(--gl-space-12);
				font-size: 1.2rem;
				line-height: 1.5;
				color: var(--color-foreground--85);
				background-color: color-mix(in srgb, var(--color-alert-errorBackground) 60%, transparent);
				border: var(--gl-border-width) solid color-mix(in srgb, var(--color-alert-errorBorder) 70%, transparent);
				border-radius: var(--gl-radius-md);
			}

			.error span {
				flex: 1;
			}
		`,
	];

	@consume({ context: settingsStateContext })
	private _state!: SettingsState;

	@property({ attribute: false })
	actions?: SettingsActions;

	private get integrations(): IntegrationStateInfo[] | undefined {
		return this._state.cloudIntegrations.get();
	}

	private get isPaidAccount(): boolean {
		return this._state.subscription.get()?.state === SubscriptionState.Paid;
	}

	private get isProAccount(): boolean {
		return isSubscriptionTrialOrPaidFromState(this._state.subscription.get()?.state);
	}

	override render(): unknown {
		const integrations = this.integrations;
		// Wait for both services so connection and pro/lock state render together
		if (integrations == null || this._state.subscription.get() === undefined) {
			// A failed fetch must not skeleton forever — offer a retry
			const errors = this._state.serviceErrors.get();
			if (errors.integrations || errors.subscription) {
				return html`<div class="error" role="alert">
					<code-icon icon="error" aria-hidden="true"></code-icon>
					<span>Couldn’t load integration status.</span>
					<gl-button appearance="secondary" @click=${() => void this.actions?.loadSharedServices()}
						>Retry</gl-button
					>
				</div>`;
			}
			return html`<skeleton-loader lines="5"></skeleton-loader>`;
		}

		const anyConnected = this._state.hasAccount.get() && integrations.some(i => i.connected);

		return html`<ul class="rows">
				${integrations.map(i => this.renderIntegrationRow(i))}
			</ul>
			<div class="panel-actions">
				${!anyConnected
					? html`<gl-button
							href="${createCommandLink<ConnectCloudIntegrationsCommandArgs>(
								'gitlens.plus.cloudIntegrations.connect',
								{
									integrationIds: integrations.map(i => i.id as SupportedCloudIntegrationIds),
									source: { source: 'settings', detail: 'integrations' },
								},
							)}"
							>Connect Integrations</gl-button
						>`
					: nothing}
				<gl-button
					appearance="secondary"
					href="${createCommandLink<ManageCloudIntegrationsCommandArgs>(
						'gitlens.plus.cloudIntegrations.manage',
						{ source: { source: 'settings', detail: 'integrations' } },
					)}"
					><code-icon icon="gear" slot="prefix" aria-hidden="true"></code-icon> Manage Integrations</gl-button
				>
				<gl-button
					appearance="secondary"
					href="${createCommandLink<Source>('gitlens.plus.validate', {
						source: 'settings',
						detail: 'integrations',
					})}"
					><code-icon icon="sync" slot="prefix" aria-hidden="true"></code-icon> Synchronize Status</gl-button
				>
			</div>`;
	}

	private renderIntegrationRow(integration: IntegrationStateInfo) {
		const showLock = integration.requiresPro && !this.isProAccount;
		const showProBadge = integration.requiresPro && !this.isPaidAccount;

		return html`<li class="row row--${integration.connected && !showLock ? 'connected' : 'disconnected'}">
			<code-icon class="row__icon" icon="${integration.icon}" aria-hidden="true"></code-icon>
			<span class="row__content">
				<span class="row__title">
					<span>${integration.name}</span>
					${showProBadge
						? html`<gl-feature-badge
								placement="right"
								.source=${{ source: 'settings', detail: 'integrations' } as const}
								.subscription=${this._state.subscription.get()}
								cloud
							></gl-feature-badge>`
						: nothing}
				</span>
				<span class="row__details">${getIntegrationDetails(integration)}</span>
			</span>
			<span class="row__actions">
				${showLock
					? html`<gl-button
							appearance="secondary"
							href="${createCommandLink<SubscriptionUpgradeCommandArgs>('gitlens.plus.upgrade', {
								plan: 'pro',
								source: 'settings',
								detail: 'integrations',
							})}"
							tooltip="Unlock ${integration.name} features with GitLens Pro"
							><code-icon icon="lock" slot="prefix" aria-hidden="true"></code-icon> Unlock with
							Pro</gl-button
						>`
					: integration.connected
						? html`<span class="row__status"
									><code-icon icon="check" aria-hidden="true"></code-icon> Connected</span
								>
								<gl-button
									appearance="secondary"
									href="${createCommandLink<ManageCloudIntegrationsCommandArgs>(
										'gitlens.plus.cloudIntegrations.manage',
										{ source: { source: 'settings', detail: 'integrations' } },
									)}"
									tooltip="Manage ${integration.name}"
									aria-label="Manage ${integration.name}"
									><code-icon icon="gear" slot="prefix" aria-hidden="true"></code-icon>
									Manage</gl-button
								>`
						: html`<gl-button
								appearance="secondary"
								href="${createCommandLink<ConnectCloudIntegrationsCommandArgs>(
									'gitlens.plus.cloudIntegrations.connect',
									{
										integrationIds: [integration.id as SupportedCloudIntegrationIds],
										source: { source: 'settings', detail: 'integrations' },
									},
								)}"
								tooltip="Connect ${integration.name}"
								><code-icon icon="plug" slot="prefix" aria-hidden="true"></code-icon> Connect</gl-button
							>`}
			</span>
		</li>`;
	}
}

const featureLabels = new Map<string, string>([
	['prs', 'pull requests'],
	['issues', 'issues'],
]);

/** Mirrors the integrations chip's supports line, e.g. "Supports pull requests and issues". */
function getIntegrationDetails(integration: IntegrationStateInfo): string {
	const features = integration.supports.map(feature => featureLabels.get(feature) ?? feature);

	if (features.length === 0) return '';
	if (features.length === 1) return `Supports ${features[0]}`;
	if (features.length === 2) return `Supports ${features[0]} and ${features[1]}`;

	const last = features.pop();
	return `Supports ${features.join(', ')}, and ${last}`;
}
