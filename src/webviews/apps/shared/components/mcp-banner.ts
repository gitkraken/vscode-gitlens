import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
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

	@state()
	private collapsed: boolean = false;

	override render(): unknown {
		if (this.collapsed) {
			return nothing;
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
