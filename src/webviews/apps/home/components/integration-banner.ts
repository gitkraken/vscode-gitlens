import { html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import '../../shared/components/button';
import '../../shared/components/button-container';
import '../../shared/components/card/card';

export const integrationBannerTagName = 'gl-integration-banner';

@customElement(integrationBannerTagName)
export class GlIntegrationBanner extends LitElement {
	override render() {
		return html`
			<gl-card>
				<p><strong>GitLens is better with integrations!</strong></p>
				<p>
					Connect hosting services like GitHub and issue trackers like Jira to track progress and take action
					on PRs and issues related to your branches.
				</p>
				<button-container>
					<gl-button
						appearance="secondary"
						href="command:gitlens.plus.cloudIntegrations.connect?%7B%22source%22%3A%22home%22%7D"
						full
						><code-icon icon="plug"></code-icon> Connect Integrations</gl-button
					>
				</button-container>
				<gl-button slot="actions" appearance="toolbar"><code-icon icon="close"></code-icon></gl-button>
			</gl-card>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[integrationBannerTagName]: GlIntegrationBanner;
	}
}
