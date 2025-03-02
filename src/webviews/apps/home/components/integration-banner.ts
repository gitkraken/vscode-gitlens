import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import type { ConnectCloudIntegrationsCommandArgs } from '../../../../commands/cloudIntegrations';
import { createCommandLink } from '../../../../system/commands';
import type { State } from '../../../home/protocol';
import { CollapseSectionCommand } from '../../../home/protocol';
import type { GlButton } from '../../shared/components/button';
import { ipcContext } from '../../shared/contexts/ipc';
import type { HostIpc } from '../../shared/ipc';
import { stateContext } from '../context';
import '../../shared/components/button';
import '../../shared/components/button-container';
import '../../shared/components/card/card';

export const integrationBannerTagName = 'gl-integration-banner';

@customElement(integrationBannerTagName)
export class GlIntegrationBanner extends LitElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = [
		css`
			gl-card::part(base) {
				margin-block-end: 1.2rem;
			}
		`,
	];

	@consume<State>({ context: stateContext, subscribe: true })
	@state()
	private _state!: State;

	@consume<HostIpc>({ context: ipcContext, subscribe: true })
	@state()
	private _ipc!: HostIpc;

	@state()
	private closed = false;

	@query('gl-button')
	private _button!: GlButton;

	override render(): unknown {
		if (this.closed || this._state.hasAnyIntegrationConnected || this._state.integrationBannerCollapsed) {
			return nothing;
		}

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
						href="${createCommandLink<ConnectCloudIntegrationsCommandArgs>(
							'gitlens.plus.cloudIntegrations.connect',
							{ source: { source: 'home' } },
						)}"
						full
						><code-icon icon="plug"></code-icon> Connect Integrations</gl-button
					>
				</button-container>
				<gl-button slot="actions" appearance="toolbar" @click=${() => this.onClose()}
					><code-icon icon="close"></code-icon
				></gl-button>
			</gl-card>
		`;
	}

	private onClose() {
		this.closed = true;

		this._ipc.sendCommand(CollapseSectionCommand, {
			section: 'integrationBanner',
			collapsed: true,
		});
	}

	override focus(): void {
		this._button.focus();
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[integrationBannerTagName]: GlIntegrationBanner;
	}
}
