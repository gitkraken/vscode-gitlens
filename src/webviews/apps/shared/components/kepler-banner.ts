import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { createCommandLink } from '../../../../system/commands.js';
import './banner/banner.js';

declare global {
	interface HTMLElementTagNameMap {
		['gl-kepler-banner']: GlKeplerBanner;
	}
}

@customElement('gl-kepler-banner')
export class GlKeplerBanner extends LitElement {
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

	// No secondary button and not dismissible, unlike the other banners in this folder — satisfying the
	// walkthrough's `kepler` step (by opening Kepler via the primary button) is the only way this banner goes away.
	override render(): unknown {
		// Both the "Learn more" link and the primary button route through `gitlens.getKepler` (rather
		// than linking `urls.kepler` directly) so either click fires `kepler/productPage/opened` telemetry and
		// satisfies the walkthrough's `kepler` step — the banner is non-dismissible, so a link that
		// bypassed the command would leave it stuck forever for anyone who only ever clicks the link.
		const keplerCommandLink = createCommandLink('gitlens.getKepler', { source: this.source });
		const bodyHtml = `Kepler, GitKraken's delivery engine for agent-driven development, starts from an issue or pull request, creates the environment, launches the agent, and keeps the work moving. <a href="${keplerCommandLink}">Learn more</a>`;

		return html`
			<gl-banner
				exportparts="base"
				display="gradient-purple"
				layout="${this.layout}"
				banner-title="Get Kepler"
				body="${bodyHtml}"
				primary-button="Get Kepler"
				primary-button-href="${keplerCommandLink}"
			></gl-banner>
		`;
	}
}
