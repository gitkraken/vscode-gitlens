import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { urls } from '../../../../constants.js';
import { createCommandLink } from '../../../../system/commands.js';
import './banner/banner.js';

declare global {
	interface HTMLElementTagNameMap {
		['gl-agents-banner']: GlAgentsBanner;
	}
}

@customElement('gl-agents-banner')
export class GlAgentsBanner extends LitElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = [
		css`
			:host {
				display: block;
			}

			gl-banner {
				margin-bottom: var(--gl-space-12);
			}

			:host([layout='responsive']) gl-banner {
				width: 100%;
				margin-bottom: 0;
			}
		`,
	];

	@property()
	source: string = 'unknown';

	@property()
	layout: 'default' | 'responsive' = 'default';

	@property({ type: Boolean, attribute: 'mcp-can-auto-register' })
	mcpCanAutoRegister: boolean = false;

	@property({ type: Boolean, attribute: 'show-cleanup-notice' })
	showCleanupNotice: boolean = false;

	@property({ type: Boolean, attribute: 'hooks-available' })
	hooksAvailable: boolean = false;

	override render(): unknown {
		const cleanupNote =
			this.mcpCanAutoRegister && this.showCleanupNotice
				? ` &mdash; <strong>Note:</strong> You may have a duplicate entry in your Cursor <code>mcp.json</code>. Remove <code>mcpServers.GitKraken</code> to clean it up.`
				: '';

		let bodyHtml: string;
		if (this.mcpCanAutoRegister && this.hooksAvailable) {
			bodyHtml = `GitKraken MCP is active in your AI chat, leveraging Git and your integrations to provide context and perform actions. <a href="${urls.helpCenterMCP}">Learn more</a> Connect agent hooks so GitLens can track your parallel agent work in real time. <a href="${urls.helpCenterAiHooks}">Learn more</a>${cleanupNote}`;
		} else if (this.mcpCanAutoRegister) {
			bodyHtml = `GitKraken MCP is active in your AI chat, leveraging Git and your integrations to provide context and perform actions. <a href="${urls.helpCenterMCP}">Learn more</a>${cleanupNote}`;
		} else if (this.hooksAvailable) {
			bodyHtml = `Leverage Git and your integrations (issues, PRs, etc) to provide context and perform actions in AI chat, and connect agent hooks so GitLens can track your parallel agent work in real time. <a href="${urls.helpCenterMCP}">Learn more</a>`;
		} else {
			bodyHtml = `Leverage Git and your integrations (issues, PRs, etc) to provide context and perform actions in AI chat. <a href="${urls.helpCenterMCP}">Learn more</a>`;
		}

		return html`
			<gl-banner
				exportparts="base"
				display="gradient-purple"
				layout="${this.layout}"
				banner-title="Connect Your AI Agents"
				body="${bodyHtml}"
				primary-button="Connect Agents"
				primary-button-href="${createCommandLink('gitlens.ai.connectAgents', { source: this.source })}"
				secondary-button="Manage Agents"
				secondary-button-href="${createCommandLink('gitlens.showSettingsPage!agents')}"
				dismissible
				dismiss-href="${createCommandLink('gitlens.onboarding.dismiss', {
					id: 'agents:banner',
				})}"
			></gl-banner>
		`;
	}
}
