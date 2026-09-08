import * as l10n from '@vscode/l10n';
import type { TemplateResult } from 'lit';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { localizedContent } from '@gitlens/components/localizedContent.js';
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
				? html` —
					${localizedContent(
						l10n.t(
							'{note} You may have a duplicate entry in your Cursor {config}. Remove {key} to clean it up.',
						),
						{
							note: html`<strong>${l10n.t('Note:')}</strong>`,
							config: html`<code>mcp.json</code>`,
							key: html`<code>mcpServers.GitKraken</code>`,
						},
					)}`
				: '';
		const learnMore = html`<a href=${urls.helpCenterMCP}>${l10n.t('Learn more')}</a>`;
		const hooksLink = html`<a href=${urls.helpCenterAiHooks}>${l10n.t('Learn more')}</a>`;
		let bodyHtml: TemplateResult;
		if (this.mcpCanAutoRegister && this.hooksAvailable) {
			bodyHtml = html`${localizedContent(l10n.t('GitKraken MCP is active in your AI chat, leveraging Git and your integrations to provide context and perform actions. {learnMore} Connect agent hooks so GitLens can track your parallel agent work in real time. {hooksLink}'), { learnMore: learnMore, hooksLink: hooksLink })}${cleanupNote}`;
		} else if (this.mcpCanAutoRegister) {
			bodyHtml = html`${localizedContent(l10n.t('GitKraken MCP is active in your AI chat, leveraging Git and your integrations to provide context and perform actions. {learnMore}'), { learnMore: learnMore })}${cleanupNote}`;
		} else if (this.hooksAvailable) {
			bodyHtml = html`${localizedContent(l10n.t('Leverage Git and your integrations (issues, PRs, etc) to provide context and perform actions in AI chat, and connect agent hooks so GitLens can track your parallel agent work in real time. {learnMore}'), { learnMore: learnMore })}`;
		} else {
			bodyHtml = html`${localizedContent(l10n.t('Leverage Git and your integrations (issues, PRs, etc) to provide context and perform actions in AI chat. {learnMore}'), { learnMore: learnMore })}`;
		}

		return html`
			<gl-banner
				exportparts="base"
				display="gradient-purple"
				layout="${this.layout}"
				banner-title=${l10n.t('Connect Your AI Agents')}
				.body=${bodyHtml}
				primary-button=${l10n.t('Connect Agents')}
				primary-button-href="${createCommandLink('gitlens.ai.connectAgents', { source: this.source })}"
				secondary-button=${l10n.t('Manage Agents')}
				secondary-button-href="${createCommandLink('gitlens.showSettingsPage!agents')}"
				dismissible
				dismiss-href="${createCommandLink('gitlens.onboarding.dismiss', {
					id: 'agents:banner',
				})}"
			></gl-banner>
		`;
	}
}
