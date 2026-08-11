import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { createCommandLink } from '../../../../system/commands.js';
import type { AgentInfo, AIState } from '../../../rpc/services/types.js';
import { srOnly } from '../../shared/components/styles/lit/a11y.css.js';
import { boxSizingBase, linkBase } from '../../shared/components/styles/lit/base.css.js';
import type { SettingsActions } from '../actions.js';
import type { SettingsState } from '../state.js';
import { settingsStateContext } from '../state.js';
import '../../shared/components/button.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/overlays/tooltip.js';
import '../../shared/components/skeleton-loader.js';
import '../../shared/components/radio/radio.js';

declare global {
	interface HTMLElementTagNameMap {
		['gl-settings-agents']: GlSettingsAgents;
	}
}

const kindOrder: AgentInfo['kind'][] = ['ide-chat', 'claude-extension', 'cli', 'editor'];
const kindLabels: Record<AgentInfo['kind'], string> = {
	'ide-chat': 'Chat',
	'claude-extension': 'Extension',
	cli: 'CLI',
	editor: 'Editors',
};
const kindIcons: Record<AgentInfo['kind'], string> = {
	'ide-chat': 'comment-discussion',
	'claude-extension': 'claude',
	cli: 'terminal',
	editor: 'robot',
};

/**
 * The Agents settings table — one row per detected agent (Chat/Extension/CLI),
 * with a Default picker and, for CLI agents only, MCP/Hooks install controls.
 *
 * Mirrors `gl-settings-scm-views`' rows-grid + radio pattern; MCP/Hooks state
 * comes from the shared `agents` RPC signal rather than config settings.
 */
@customElement('gl-settings-agents')
export class GlSettingsAgents extends SignalWatcher(LitElement) {
	static override styles = [
		boxSizingBase,
		linkBase,
		srOnly,
		css`
			:host {
				display: block;
				--status-color--connected: var(--vscode-testing-iconPassed, var(--vscode-charts-green));
			}

			.rows {
				display: grid;
				grid-template-columns: 1fr auto auto auto;
				gap: var(--gl-space-4) var(--gl-space-16);
				align-items: center;
			}

			.header {
				display: contents;
			}

			.header span {
				padding-block-end: var(--gl-space-4);
				font-size: 1.1rem;
				font-weight: 600;
				color: var(--color-foreground--65);
				text-transform: uppercase;
				letter-spacing: 0.04em;
				border-block-end: var(--gl-border-width) solid var(--vscode-widget-border, var(--color-foreground--25));
			}

			.header__col,
			.cell {
				text-align: center;
				justify-self: center;
			}

			.cell__button {
				--button-padding-inline: var(--gl-space-6);
			}

			.section {
				grid-column: 1 / -1;
				padding-block: var(--gl-space-8) var(--gl-space-2);
				font-size: 1.05rem;
				font-weight: 600;
				color: var(--color-foreground--50);
				text-transform: uppercase;
				letter-spacing: 0.04em;
			}

			.row {
				display: contents;
			}

			.row__agent {
				display: flex;
				gap: var(--gl-space-8);
				align-items: center;
				padding-block: var(--gl-space-6);
			}

			.row__agent code-icon {
				flex: none;
				color: var(--color-foreground--65);
			}

			.row--dimmed .row__agent {
				color: var(--color-foreground--50);
			}

			.row--dimmed .row__agent code-icon {
				color: var(--color-foreground--50);
			}

			.row__not-detected {
				font-size: 1rem;
				font-weight: 400;
			}

			.cell__status {
				display: inline-flex;
				gap: 0.4rem;
				align-items: center;
				font-size: 1.15rem;
				color: var(--status-color--connected);
			}

			.cell__dash {
				color: var(--color-foreground--50);
			}

			gl-radio {
				justify-self: center;
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

			.error {
				display: flex;
				gap: var(--gl-space-8);
				align-items: center;
				padding: var(--gl-space-10) var(--gl-space-12);
				font-size: 1.2rem;
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

	private get agents(): AgentInfo[] | undefined {
		return this._state.agents.get();
	}

	private get defaultAgentId(): string | undefined {
		return this._state.getSettingValue<string>('ai.defaultAgent');
	}

	override render(): unknown {
		const ai = this.ai;
		if (ai == null) {
			if (this._state.serviceErrors.get().ai) return this.renderError('Couldn’t load AI status.');
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
				<span>AI features are currently disabled — enable them in the AI settings to configure agents.</span>
			</p>`;
		}

		const agents = this.agents;
		if (agents == null) {
			if (this._state.serviceErrors.get().agents) return this.renderError('Couldn’t load agents.');
			return html`<skeleton-loader lines="4"></skeleton-loader>`;
		}

		if (agents.length === 0) {
			return html`<p class="note">
				<code-icon icon="info" aria-hidden="true"></code-icon>
				<span>No agents detected. Install a supported chat, extension, or CLI agent to configure it here.</span>
			</p>`;
		}

		return html`<div class="rows">
			<div class="header">
				<span>Agent</span>
				<gl-tooltip content="The agent GitLens uses by default for AI features"
					><span class="header__col">Default</span></gl-tooltip
				>
				<gl-tooltip
					content="GitKraken's MCP server gives this agent access to GitLens tools and repository context"
					><span class="header__col">MCP</span></gl-tooltip
				>
				<gl-tooltip content="GitKraken hooks let GitLens track this agent's sessions and coordinate permissions"
					><span class="header__col">Hooks</span></gl-tooltip
				>
			</div>
			${kindOrder.map(kind =>
				this.renderSection(
					kind,
					agents.filter(a => a.kind === kind),
				),
			)}
		</div>`;
	}

	private renderSection(kind: AgentInfo['kind'], list: AgentInfo[]) {
		if (list.length === 0) return nothing;
		return html`<div class="section">${kindLabels[kind]}</div>
			${list.map(a => this.renderRow(a))}`;
	}

	private renderRow(agent: AgentInfo) {
		const isEditor = agent.kind === 'editor';
		const notDetected = agent.detected === false;
		const isDefault = this.defaultAgentId === agent.id;
		return html`<div class="row ${notDetected ? 'row--dimmed' : ''}">
			<span class="row__agent">
				<code-icon icon=${kindIcons[agent.kind]} aria-hidden="true"></code-icon>
				<span>${agent.label}</span>
				${notDetected ? html`<span class="cell__dash row__not-detected">Not detected</span>` : nothing}
			</span>
			${
				notDetected
					? html`<span class="cell">${this.renderDash('Not detected')}</span>`
					: isEditor
						? html`<span class="cell"></span>`
						: html`<gl-radio .checked=${isDefault} @click=${() => this.setDefault(agent.id)}>
								<span class="sr-only">Set ${agent.label} as the default agent</span>
							</gl-radio>`
			}
			<span class="cell">${notDetected ? this.renderDash('Not detected') : this.renderMcpCell(agent)}</span>
			<span class="cell">${notDetected ? this.renderDash('Not detected') : this.renderHooksCell(agent)}</span>
		</div>`;
	}

	private setDefault(id: string): void {
		void this.actions?.applyValue('ai.defaultAgent', id);
	}

	private renderMcpCell(agent: AgentInfo) {
		if (agent.kind === 'editor' || agent.kind === 'ide-chat') return this.renderEditorMcpCell();

		// The Claude Code Extension runs on the Claude Code CLI — reflect the CLI's install state read-only;
		// the actual install/uninstall controls live on the CLI row.
		if (agent.kind === 'claude-extension') {
			return agent.mcp?.installed
				? this.renderInstalledViaCli()
				: this.renderDash('GitKraken MCP not installed via the Claude Code CLI');
		}

		const mcp = agent.mcp;
		if (agent.kind !== 'cli' || mcp == null || !mcp.supported) {
			return this.renderDash('MCP not available');
		}
		if (mcp.installed) {
			return this.renderInstalled(
				createCommandLink<{ agentId: string; source: string }>('gitlens.ai.mcp.uninstallForAgent', {
					agentId: agent.id,
					source: 'settings',
				}),
				`Uninstall GitKraken MCP for ${agent.label}`,
			);
		}
		return html`<gl-button
			class="cell__button"
			appearance="secondary"
			href="${createCommandLink<{ agentId: string; source: string }>('gitlens.ai.mcp.installForAgent', {
				agentId: agent.id,
				source: 'settings',
			})}"
			aria-label="Install GitKraken MCP for ${agent.label}"
			tooltip="Install GitKraken MCP for ${agent.label}"
			><code-icon icon="plug" aria-hidden="true"></code-icon
		></gl-button>`;
	}

	private renderEditorMcpCell() {
		const mcp = this.ai?.mcp;
		if (mcp == null || !mcp.capable) return this.renderDash('GitKraken MCP is not available in this editor');
		if (mcp.bundled) {
			return html`<span class="cell__status">
				<gl-tooltip content="GitKraken MCP is available in this editor"
					><code-icon icon="check" aria-label="GitKraken MCP is available in this editor"></code-icon
				></gl-tooltip>
				<gl-button
					class="cell__button"
					appearance="secondary"
					aria-label="Disable the bundled GitKraken MCP server for this editor"
					tooltip="Disable the bundled GitKraken MCP server for this editor"
					@click=${() => this.actions?.applyValue('gitkraken.mcp.autoEnabled', false)}
					><code-icon icon="gl-unplug" aria-hidden="true"></code-icon
				></gl-button>
			</span>`;
		}
		return html`<gl-button
			class="cell__button"
			appearance="secondary"
			aria-label="Enable the bundled GitKraken MCP server for this editor"
			tooltip="Enable the bundled GitKraken MCP server for this editor"
			@click=${() => this.actions?.applyValue('gitkraken.mcp.autoEnabled', true)}
			><code-icon icon="plug" aria-hidden="true"></code-icon
		></gl-button>`;
	}

	private renderInstalled(uninstallHref: string, uninstallLabel: string) {
		return html`<span class="cell__status">
			<gl-tooltip content="Installed"><code-icon icon="check" aria-label="Installed"></code-icon></gl-tooltip>
			<gl-button
				class="cell__button"
				appearance="secondary"
				href="${uninstallHref}"
				aria-label="${uninstallLabel}"
				tooltip="${uninstallLabel}"
				><code-icon icon="gl-unplug" aria-hidden="true"></code-icon
			></gl-button>
		</span>`;
	}

	/** Read-only installed check for state managed elsewhere (e.g. the Claude Code Extension reflecting
	 *  the Claude Code CLI) — no uninstall control, since it isn't managed from this row. */
	private renderInstalledViaCli() {
		return html`<span class="cell__status">
			<gl-tooltip content="Installed via Claude Code CLI"
				><code-icon icon="check" aria-label="Installed via Claude Code CLI"></code-icon
			></gl-tooltip>
		</span>`;
	}

	private renderHooksCell(agent: AgentInfo) {
		const hooks = agent.hooks;
		// The Claude Code Extension reflects the Claude Code CLI's hooks state read-only (managed on the CLI row).
		if (agent.kind === 'claude-extension') {
			return hooks?.installed
				? this.renderInstalledViaCli()
				: this.renderDash('GitKraken hooks not installed via the Claude Code CLI');
		}

		if (
			(agent.kind !== 'cli' && agent.kind !== 'editor' && agent.kind !== 'ide-chat') ||
			hooks == null ||
			!hooks.supported
		) {
			return this.renderDash('Hooks not available');
		}

		const agentId = agent.hooksAgentId ?? agent.id;
		if (hooks.installed) {
			return this.renderInstalled(
				createCommandLink<{ agentId: string; source: string }>('gitlens.agents.uninstallHooksForAgent', {
					agentId: agentId,
					source: 'settings',
				}),
				`Uninstall GitKraken Hooks for ${agent.label}`,
			);
		}
		return html`<gl-button
			class="cell__button"
			appearance="secondary"
			href="${createCommandLink<{ agentId: string; source: string }>('gitlens.agents.installHooksForAgent', {
				agentId: agentId,
				source: 'settings',
			})}"
			aria-label="Install GitKraken Hooks for ${agent.label}"
			tooltip="Install GitKraken Hooks for ${agent.label}"
			><code-icon icon="plug" aria-hidden="true"></code-icon
		></gl-button>`;
	}

	private renderDash(label: string) {
		return html`<span class="cell__dash" aria-label=${label}>—</span>`;
	}

	private renderError(message: string) {
		return html`<div class="error" role="alert">
			<code-icon icon="error" aria-hidden="true"></code-icon>
			<span>${message}</span>
			<gl-button appearance="secondary" @click=${() => void this.actions?.loadSharedServices()}>Retry</gl-button>
		</div>`;
	}
}
