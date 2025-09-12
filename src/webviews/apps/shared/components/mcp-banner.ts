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
			const bodyHtml = `GitKraken MCP is active in your AI chat, leveraging Git and your integrations to provide context and perform actions. <a href="${urls.helpCenterMCP}">Learn more</a>`;

			return html`
				<gl-banner
					exportparts="base"
					display="gradient-purple"
					layout="${this.layout}"
					banner-title="GitKraken MCP Bundled with GitLens"
					body="${bodyHtml}"
					dismissible
					dismiss-href="${createCommandLink('gitlens.storage.store', {
						key: 'mcp:banner:dismissed',
						value: true,
					})}"
				></gl-banner>
			`;
		}

		const bodyHtml = `Leverage Git and your integrations (issues, PRs, etc) to provide context and perform actions in AI chat. <a href="${urls.helpCenterMCP}">Learn more</a>`;

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
