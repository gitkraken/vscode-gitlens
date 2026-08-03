import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import type { Source } from '../../../../../constants.telemetry.js';
import { createCommandLink } from '../../../../../system/commands.js';
import type { AIState } from '../../../../rpc/services/types.js';
import { focusableBaseStyles } from '../../../shared/components/styles/lit/a11y.css.js';
import { boxSizingBase, linkBase } from '../../../shared/components/styles/lit/base.css.js';
import type { AIContextState } from '../../../shared/contexts/ai.js';
import { aiContext } from '../../../shared/contexts/ai.js';
import { chipStyles } from './chipStyles.js';
import { integrationRowStyles } from './integrationRowStyles.js';
import '../../../shared/components/button.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/overlays/tooltip.js';
import '../../../shared/components/feature-badge.js';

declare global {
	interface HTMLElementTagNameMap {
		'gl-ai-panel': GlAiPanel;
	}
}

/**
 * The AI panel — AI provider/model, GitKraken MCP, Default Coding Agent, and Claude Code Hooks rows.
 * Used by the graph account modal and composed by `gl-integrations-chip`'s popover.
 */
@customElement('gl-ai-panel')
export class GlAiPanel extends SignalWatcher(LitElement) {
	@consume({ context: aiContext })
	private _ai!: AIContextState;

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
		`,
	];

	private get ai(): AIState {
		return this._ai.state.get();
	}

	private get aiEnabled(): boolean {
		return this.ai.enabled && this.ai.orgEnabled;
	}

	override render(): unknown {
		return html`<div class="header">
				<span class="header__title">AI / Agents</span>
			</div>
			<div class="integrations">
				${this.renderAIRow()}${this.renderMcpRow()}${this.renderDefaultAgentRow()}${this.renderHooksRow()}
			</div>`;
	}

	private renderAIRow() {
		const model = this._ai.model.get();

		const connectedAndEnabled = this.aiEnabled && model != null;
		const showLock = !this.aiEnabled;
		const showProBadge = false;
		const icon = connectedAndEnabled ? 'sparkle-filled' : 'sparkle'; // TODO: Provider?

		return html`<div
			class="integration-row integration-row--ai status--${
				connectedAndEnabled ? 'connected' : 'disconnected'
			}${showLock ? ' is-locked' : ''}"
		>
			<span class="integration__icon"><code-icon icon="${icon}"></code-icon></span>
			${
				this.aiEnabled
					? html`<span class="integration__content">
								${
									model?.provider.name
										? html`<span class="integration__title">
												<span>${model.provider.name}</span>
												${
													showProBadge
														? html` <gl-feature-badge
																placement="right"
																.source=${{ source: 'home', detail: 'integrations' } as const}
																cloud
															></gl-feature-badge>`
														: nothing
												}
											</span>`
										: html`<span class="integration_details"
												>Select AI model to enable AI features</span
											>`
								}
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
							${
								!this.ai.enabled
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
									: nothing
							}`
			}
		</div>`;
	}

	private renderMcpRow() {
		const { mcp } = this.ai;
		const mcpEnabled = this.aiEnabled && mcp.settingEnabled;
		const active = mcpEnabled && mcp.installed;

		return html`<div class="integration-row integration-row--mcp status--${active ? 'connected' : 'disconnected'}">
			<span class="integration__icon"><code-icon icon="mcp"></code-icon></span>
			${
				mcpEnabled
					? mcp.installed
						? html`<span class="integration__content">
									<span class="integration__title">GitKraken MCP</span>
									<span class="integration__details"
										>Leverage Git &amp; Integrations in AI chats</span
									>
								</span>
								<span class="integration__actions">
									<gl-button
										appearance="toolbar"
										href="${createCommandLink<Source>('gitlens.ai.mcp.selectAgents', {
											source: 'home',
											detail: 'integrations',
										})}"
										tooltip="Connect More Agents"
										aria-label="Connect More Agents"
										><code-icon icon="plug"></code-icon
									></gl-button>
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
									<span class="integration__details"
										>Leverage Git &amp; Integrations in AI chats</span
									>
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
								${
									!this.ai.enabled
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
										: nothing
								}`
						: html`<span class="integration__content">
									<span class="integration_details"
										>GitKraken MCP has been disabled via settings</span
									>
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
								</span>`
			}
		</div>`;
	}

	private renderDefaultAgentRow() {
		if (!this.aiEnabled) return nothing;

		const agent = this.ai.defaultAgent;
		return html`<div
			class="integration-row integration-row--default-agent status--${
				agent != null ? 'connected' : 'disconnected'
			}"
		>
			<span class="integration__icon"><code-icon icon="robot"></code-icon></span>
			<span class="integration__content">
				<span class="integration__title">Default Coding Agent</span>
				<span class="integration__details">${agent != null ? agent.label : 'No default agent selected'}</span>
			</span>
			<span class="integration__actions">
				<gl-button
					appearance="toolbar"
					href="${createCommandLink('gitlens.agents.switchDefaultAgent')}"
					tooltip="Switch Default Agent"
					aria-label="Switch Default Agent"
					><code-icon icon="arrow-swap"></code-icon
				></gl-button>
			</span>
		</div>`;
	}

	private renderHooksRow() {
		if (!this.aiEnabled) return nothing;

		const claude = this.ai.hooks.claude;
		// Don't render at all if gkcli says hooks aren't supported for Claude on this machine, or
		// if Claude isn't detected — there's nothing to install OR uninstall.
		if (!claude.supported || !claude.detected) return nothing;

		if (claude.installed) {
			return html`<div class="integration-row integration-row--hooks status--connected">
				<span class="integration__icon"><code-icon icon="search-sparkle"></code-icon></span>
				<span class="integration__content">
					<span class="integration__title">GitKraken Claude Code Hooks</span>
					<span class="integration__details">Installed — Claude surfaces agent status</span>
				</span>
				<span class="integration__actions">
					<gl-button
						appearance="toolbar"
						href="${createCommandLink('gitlens.agents.uninstallClaudeHook')}"
						tooltip="Uninstall Claude Hooks"
						aria-label="Uninstall Claude Hooks"
						><code-icon icon="debug-disconnect"></code-icon
					></gl-button>
				</span>
			</div>`;
		}

		return html`<div class="integration-row integration-row--hooks status--disconnected">
			<span class="integration__icon"><code-icon icon="search-sparkle"></code-icon></span>
			<span class="integration__content">
				<span class="integration__title">GitKraken Claude Code Hooks</span>
				<span class="integration__details">Configure Claude to surface agent status</span>
			</span>
			<span class="integration__actions">
				<gl-button
					appearance="toolbar"
					href="${createCommandLink('gitlens.agents.installClaudeHook')}"
					tooltip="Install Claude Hooks"
					aria-label="Install Claude Hooks"
					><code-icon icon="plug"></code-icon
				></gl-button>
			</span>
		</div>`;
	}
}
