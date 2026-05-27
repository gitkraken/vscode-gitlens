import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { urls } from '../../../../constants.js';
import { createCommandLink } from '../../../../system/commands.js';
import './banner/banner.js';

export const hooksBannerTagName = 'gl-hooks-banner';

@customElement(hooksBannerTagName)
export class GlHooksBanner extends LitElement {
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

	override render(): unknown {
		if (this.collapsed) return nothing;

		const bodyHtml = `Configure Claude to send status updates to GitLens so you can see and manage your parallel agent work. <a href="${urls.helpCenterAiHooks}">Learn more</a>`;

		return html`
			<gl-banner
				exportparts="base"
				display="gradient-purple"
				layout="${this.layout}"
				banner-title="Install Claude Code Hooks"
				body="${bodyHtml}"
				primary-button="Install Hooks"
				primary-button-href="${createCommandLink('gitlens.agents.installClaudeHook')}"
				dismissible
				dismiss-href="${createCommandLink('gitlens.onboarding.dismiss', {
					id: 'hooks:banner',
				})}"
			></gl-banner>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[hooksBannerTagName]: GlHooksBanner;
	}
}
