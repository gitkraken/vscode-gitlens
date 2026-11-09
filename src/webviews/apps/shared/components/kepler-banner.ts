import * as l10n from '@vscode/l10n';
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

	/** Whether GitLens can install Kepler here; otherwise only Learn More is shown */
	@property({ type: Boolean })
	installable = false;

	/** Whether GitLens is installing Kepler right now; disables Install Kepler */
	@property({ type: Boolean })
	installing = false;

	// Not dismissible, unlike the other banners in this folder — the walkthrough's `kepler` step, which
	// installing Kepler or Learn More satisfies, is the only way this banner goes away.
	override render(): unknown {
		// Learn More routes through `gitlens.kepler.openProductPage` (rather than linking `urls.kepler`
		// directly) so the click fires `kepler/productPage/opened` telemetry and satisfies the
		// walkthrough's `kepler` step — the banner is non-dismissible, so a link that bypassed the command
		// would leave it stuck forever for anyone who doesn't install Kepler.
		const learnMoreLink = createCommandLink('gitlens.kepler.openProductPage', { source: this.source });
		const body = l10n.t(
			'Kepler is the agent-agnostic development environment for running AI agents across the entire development workflow, from idea or issue to merged PR.',
		);

		if (!this.installable) {
			return html`
				<gl-banner
					exportparts="base"
					display="gradient-purple"
					layout="${this.layout}"
					banner-title=${l10n.t('Try Kepler')}
					title-icon="gl-kepler"
					.body=${body}
					primary-button=${l10n.t('Learn More')}
					primary-button-href="${learnMoreLink}"
				></gl-banner>
			`;
		}

		return html`
			<gl-banner
				exportparts="base"
				display="gradient-purple"
				layout="${this.layout}"
				banner-title=${l10n.t('Try Kepler')}
				title-icon="gl-kepler"
				.body=${body}
				primary-button=${this.installing ? l10n.t('Installing Kepler…') : l10n.t('Install Kepler')}
				primary-button-href="${createCommandLink('gitlens.kepler.install', { source: this.source })}"
				primary-appearance="default"
				?primary-button-disabled=${this.installing}
				secondary-button=${l10n.t('Learn More')}
				secondary-button-href="${learnMoreLink}"
			></gl-banner>
		`;
	}
}
