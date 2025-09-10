import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { urls } from '../../../../constants';
import { createCommandLink } from '../../../../system/commands';
import './banner/banner';

export const mcpBannerTagName = 'gl-mcp-banner';

export interface McpBannerSource {
	source: string;
}

@customElement(mcpBannerTagName)
export class GlMcpBanner extends LitElement {
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
				margin-bottom: 1.2rem;
			}

			:host([layout='responsive']) gl-banner {
				margin-bottom: 0;
				width: 100%;
			}
		`,
	];

	@property()
	source: string = 'unknown';

	@property()
	layout: 'default' | 'responsive' = 'default';

	@property({ type: Boolean })
	collapsed: boolean = false;

	@property({ type: Boolean })
	private canAutoRegister: boolean = false;

	override render(): unknown {
		if (this.collapsed) {
			return nothing;
		}

		if (this.canAutoRegister) {
			const bodyHtml = `GitKraken MCP is now active in Copilot chat. Ask Copilot to "start work on issue PROJ-123" or "create a PR for my commits" to see Git workflows powered by AI. <a href="${urls.helpCenterMCP}">Learn more</a>`;

			return html`
				<gl-banner
					exportparts="base"
					display="gradient-purple"
					layout="${this.layout}"
					banner-title="GitKraken MCP for GitLens is Here!"
					body="${bodyHtml}"
					dismissible
					dismiss-href="${createCommandLink('gitlens.storage.store', {
						key: 'mcp:banner:dismissed',
						value: true,
					})}"
				></gl-banner>
			`;
		}

		const bodyHtml = `Leverage Git and Integration information from GitLens in AI chat. <a href="${urls.helpCenterMCP}">Learn more</a>`;

		return html`
			<gl-banner
				exportparts="base"
				display="gradient-purple"
				layout="${this.layout}"
				banner-title="Install GitKraken MCP for GitLens"
				body="${bodyHtml}"
				primary-button="Install GitKraken MCP"
				primary-button-href="${createCommandLink('gitlens.ai.mcp.install', { source: this.source })}"
				dismissible
				dismiss-href="${createCommandLink('gitlens.storage.store', {
					key: 'mcp:banner:dismissed',
					value: true,
				})}"
			></gl-banner>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[mcpBannerTagName]: GlMcpBanner;
	}
}
