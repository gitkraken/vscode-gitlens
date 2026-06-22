import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Source } from '../../../../constants.telemetry.js';
import { createCommandLink } from '../../../../system/commands.js';
import type { AIState } from '../../../rpc/services/types.js';
import { boxSizingBase, linkBase } from '../../shared/components/styles/lit/base.css.js';
import type { SettingsActions } from '../actions.js';
import type { SettingsState } from '../state.js';
import { settingsStateContext } from '../state.js';
import '../../shared/components/button.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/skeleton-loader.js';

export const tagName = 'gl-settings-ai';

/**
 * The AI integrations panel — provider/model, GitKraken MCP, default coding
 * agent, and Claude Code hooks rows, mirroring the Home view's integrations chip.
 *
 * Aside from the category's master switch (`gitlens.ai.enabled`), these aren't
 * config settings: state comes from the shared AI RPC service and all actions
 * run commands (switch model, install MCP, switch agent, install hooks).
 */
@customElement(tagName)
export class GlSettingsAI extends SignalWatcher(LitElement) {
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

			.note {
				display: flex;
				gap: var(--gl-space-8);
				padding: var(--gl-space-10) var(--gl-space-12);
				font-size: 1.2rem;
				line-height: 1.5;
				color: var(--color-foreground--85);
				background-color: color-mix(in srgb, var(--color-alert-infoBackground) 60%, transparent);
				border: var(--gl-border-width) solid color-mix(in srgb, var(--color-alert-infoBorder) 70%, transparent);
				border-radius: var(--gl-radius-md);
			}

			.note code-icon {
				flex: none;
				margin-block-start: var(--gl-space-2);
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
				display: block;
				font-size: 1.25rem;
				color: var(--color-foreground);
			}

			.row__details {
				display: block;
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

	private get ai(): AIState | undefined {
		return this._state.aiState.get();
	}

	override render(): unknown {
		const ai = this.ai;
		if (ai == null) {
			// A failed fetch must not skeleton forever — offer a retry
			if (this._state.serviceErrors.get().ai) {
				return html`<div class="error" role="alert">
					<code-icon icon="error" aria-hidden="true"></code-icon>
					<span>Couldn’t load AI status.</span>
					<gl-button appearance="secondary" @click=${() => void this.actions?.loadSharedServices()}
						>Retry</gl-button
					>
				</div>`;
			}
			return html`<skeleton-loader lines="4"></skeleton-loader>`;
		}

		if (!ai.orgEnabled) {
			return html`<p class="note">
				<code-icon icon="org" aria-hidden="true"></code-icon>
				<span>AI features have been disabled by your GitKraken admin.</span>
			</p>`;
		}

		if (!ai.enabled) {
			return html`<p class="note">
				<code-icon icon="info" aria-hidden="true"></code-icon>
				<span>AI features are currently disabled — use the switch above to enable them.</span>
			</p>`;
		}

		return html`<ul class="rows">
			${this.renderModelRow()}${this.renderMcpRow(ai)}${this.renderDefaultAgentRow(ai)}${this.renderHooksRow(ai)}
		</ul>`;
	}

	private renderModelRow() {
		const model = this._state.aiModel.get();
		// A failed model fetch must not masquerade as "no model selected"
		const failed = model == null && this._state.serviceErrors.get().ai;

		return html`<li class="row row--${model != null ? 'connected' : 'disconnected'}">
			<code-icon
				class="row__icon"
				icon="${model != null ? 'sparkle-filled' : 'sparkle'}"
				aria-hidden="true"
			></code-icon>
			<span class="row__content">
				<span class="row__title">${model?.provider.name ?? 'AI Provider & Model'}</span>
				<span class="row__details"
					>${model?.name ??
					(failed ? 'Couldn’t load the current model' : 'Select an AI model to enable AI features')}</span
				>
			</span>
			<span class="row__actions">
				<gl-button
					appearance="secondary"
					href="${createCommandLink<Source>('gitlens.ai.switchProvider', {
						source: 'settings',
						detail: 'integrations',
					})}"
					tooltip="Switch AI Provider/Model"
					><code-icon icon="arrow-swap" slot="prefix" aria-hidden="true"></code-icon> Switch Model</gl-button
				>
			</span>
		</li>`;
	}

	private renderMcpRow(ai: AIState) {
		const { mcp } = ai;
		const active = mcp.settingEnabled && mcp.installed;

		return html`<li class="row row--${active ? 'connected' : 'disconnected'}">
			<code-icon class="row__icon" icon="mcp" aria-hidden="true"></code-icon>
			<span class="row__content">
				<span class="row__title">GitKraken MCP</span>
				<span class="row__details"
					>${mcp.settingEnabled
						? 'Leverage Git & Integrations in AI chats'
						: 'GitKraken MCP has been disabled via settings'}</span
				>
			</span>
			<span class="row__actions">
				${!mcp.settingEnabled
					? html`<gl-button
							appearance="secondary"
							href="${createCommandLink<Source>('gitlens.ai.mcp.install', {
								source: 'settings',
								detail: 'integrations',
							})}"
							tooltip="Re-enable GitKraken MCP"
							><code-icon icon="unlock" slot="prefix" aria-hidden="true"></code-icon> Re-enable</gl-button
						>`
					: mcp.installed
						? html`<gl-button
									appearance="secondary"
									href="${createCommandLink<Source>('gitlens.ai.mcp.selectAgents', {
										source: 'settings',
										detail: 'integrations',
									})}"
									tooltip="Connect More Agents"
									><code-icon icon="plug" slot="prefix" aria-hidden="true"></code-icon> Connect
									Agents</gl-button
								>
								<gl-button
									appearance="secondary"
									href="${createCommandLink<Source>('gitlens.ai.mcp.reinstall', {
										source: 'settings',
										detail: 'integrations',
									})}"
									tooltip="Reinstall GitKraken MCP"
									><code-icon icon="sync" slot="prefix" aria-hidden="true"></code-icon>
									Reinstall</gl-button
								>
								<span class="row__status"
									><code-icon icon="check" aria-hidden="true"></code-icon> Installed${mcp.bundled
										? ' (bundled)'
										: ''}</span
								>`
						: html`<gl-button
								appearance="secondary"
								href="${createCommandLink<Source>('gitlens.ai.mcp.install', {
									source: 'settings',
									detail: 'integrations',
								})}"
								tooltip="Install GitKraken MCP"
								><code-icon icon="plug" slot="prefix" aria-hidden="true"></code-icon> Install</gl-button
							>`}
			</span>
		</li>`;
	}

	private renderDefaultAgentRow(ai: AIState) {
		const agent = ai.defaultAgent;

		return html`<li class="row row--${agent != null ? 'connected' : 'disconnected'}">
			<code-icon class="row__icon" icon="robot" aria-hidden="true"></code-icon>
			<span class="row__content">
				<span class="row__title">Default Coding Agent</span>
				<span class="row__details">${agent != null ? agent.label : 'No default agent selected'}</span>
			</span>
			<span class="row__actions">
				<gl-button
					appearance="secondary"
					href="${createCommandLink('gitlens.agents.switchDefaultAgent')}"
					tooltip="Switch Default Agent"
					><code-icon icon="arrow-swap" slot="prefix" aria-hidden="true"></code-icon> Switch Agent</gl-button
				>
			</span>
		</li>`;
	}

	private renderHooksRow(ai: AIState) {
		const claude = ai.hooks.claude;
		// Nothing to install OR uninstall if hooks aren't supported on this
		// machine or Claude isn't detected (mirrors the integrations chip)
		if (!claude.supported || !claude.detected) return nothing;

		return html`<li class="row row--${claude.installed ? 'connected' : 'disconnected'}">
			<code-icon class="row__icon" icon="search-sparkle" aria-hidden="true"></code-icon>
			<span class="row__content">
				<span class="row__title">GitKraken Claude Code Hooks</span>
				<span class="row__details"
					>${claude.installed
						? 'Installed — Claude surfaces agent status'
						: 'Configure Claude to surface agent status'}</span
				>
			</span>
			<span class="row__actions">
				${claude.installed
					? html`<gl-button
							appearance="secondary"
							href="${createCommandLink('gitlens.agents.uninstallClaudeHook')}"
							tooltip="Uninstall Claude Hooks"
							><code-icon icon="debug-disconnect" slot="prefix" aria-hidden="true"></code-icon>
							Uninstall</gl-button
						>`
					: html`<gl-button
							appearance="secondary"
							href="${createCommandLink('gitlens.agents.installClaudeHook')}"
							tooltip="Install Claude Hooks"
							><code-icon icon="plug" slot="prefix" aria-hidden="true"></code-icon> Install</gl-button
						>`}
			</span>
		</li>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[tagName]: GlSettingsAI;
	}
}
