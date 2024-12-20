import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import type {
	ConnectCloudIntegrationsCommandArgs,
	ManageCloudIntegrationsCommandArgs,
} from '../../../../../commands/cloudIntegrations';
import type { IntegrationFeatures } from '../../../../../constants.integrations';
import type { Source } from '../../../../../constants.telemetry';
import { hasAccountFromSubscriptionState } from '../../../../../plus/gk/account/subscription';
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

@customElement('gl-integrations-chip')
export class GLIntegrationsChip extends LitElement {
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
				gap: 0.8rem;
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

			.status--connected .status-indicator {
				color: var(--status-color--connected);
			}

			.status--connected .status-indicator {
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

			.status--disconnected .integration__icon {
				color: var(--color-foreground--25);
			}

			.status--disconnected .integration__title {
				color: var(--color-foreground--50);
			}

			.integration__details {
				display: flex;
				color: var(--color-foreground--75);
				font-size: 1rem;
			}

			.status--disconnected .integration__details {
				color: var(--color-foreground--50);
			}

			.integration__actions {
				flex: 1 1 auto;
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

	private get hasConnectedIntegrations() {
		return this.hasAccount && this.integrations.some(i => i.connected);
	}

	private get integrations() {
		return this._state.integrations;
	}

	override focus() {
		this._chip.focus();
	}

	override render() {
		const anyConnected = this.hasConnectedIntegrations;
		return html`<gl-popover placement="bottom" trigger="hover click focus" hoist>
			<span slot="anchor" class="chip" tabindex="0"
				>${!anyConnected ? html`<span class="chip__label">Connect</span>` : ''}${this.integrations.map(i =>
					this.renderIntegrationStatus(i, anyConnected),
				)}</span
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
								source: 'home',
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
												source: 'home',
											},
										)}"
										>Connect Integrations</gl-button
									>
								</button-container>`
						: this.integrations.map(i => this.renderIntegrationRow(i))
				}</div>
			</div>
		</gl-popover>`;
	}

	private renderIntegrationStatus(integration: IntegrationState, anyConnected: boolean) {
		return html`<span
			class="integration status--${integration.connected ? 'connected' : 'disconnected'}"
			slot="anchor"
			><code-icon icon="${integration.icon}"></code-icon>${anyConnected
				? html`<code-icon
						class="status-indicator"
						icon="${integration.connected ? 'check' : 'gl-unplug'}"
						size="12"
				  ></code-icon>`
				: nothing}</span
		>`;
	}

	private renderIntegrationRow(integration: IntegrationState) {
		return html`<div class="integration-row status--${integration.connected ? 'connected' : 'disconnected'}">
			<span slot="anchor"><code-icon class="integration__icon" icon="${integration.icon}"></code-icon></span>
			<span>
				<span class="integration__title">${integration.name}</span>
				<span class="integration__details">${getIntegrationDetails(integration)}</span>
			</span>
			<span class="integration__actions">
				${integration.connected
					? html`<gl-tooltip class="status-indicator status--connected" placement="bottom" content="Connected"
							><code-icon class="status-indicator" icon="check"></code-icon
					  ></gl-tooltip>`
					: html`<gl-button
							appearance="toolbar"
							href="${createCommandLink<ConnectCloudIntegrationsCommandArgs>(
								'gitlens.plus.cloudIntegrations.connect',
								{
									integrationIds: [integration.id],
									source: 'account',
								},
							)}"
							tooltip="Connect ${integration.name}"
							aria-label="Connect ${integration.name}"
							><code-icon icon="plug"></code-icon
					  ></gl-button>`}
			</span>
		</div>`;
	}
}
const featureMap = new Map<IntegrationFeatures, string>([
	['prs', 'Pull Requests'],
	['issues', 'Issues'],
]);
function getIntegrationDetails(integration: IntegrationState): string {
	const features = integration.supports.map(feature => featureMap.get(feature)!);

	if (features.length === 0) return '';
	if (features.length === 1) return `Supports ${features[0]}`;

	const last = features.pop();
	return `Supports ${features.join(', ')} and ${last}`;
}
