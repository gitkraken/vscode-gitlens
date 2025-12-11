import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { State } from '../../../home/protocol';
import { CollapseSectionCommand } from '../../../home/protocol';
import { ipcContext } from '../../shared/contexts/ipc';
import type { HostIpc } from '../../shared/ipc';
import { stateContext } from '../context';
import './welcome-page';

declare global {
	interface HTMLElementTagNameMap {
		'gl-welcome-overlay': GlWelcomeOverlay;
	}
}

@customElement('gl-welcome-overlay')
export class GlWelcomeOverlay extends LitElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = [
		css`
			:host {
				--background-color: var(--vscode-editor-background);
			}
			.overlay {
				position: fixed;
				top: 0;
				left: 0;
				right: 0;
				bottom: 0;
				z-index: 1000;
				display: block;
				background-color: var(--background-color);
			}

			gl-welcome-page {
				--page-background-color: var(--background-color);
			}
		`,
	];

	@property({ type: String })
	webroot?: string;

	@property({ type: Boolean })
	private isLightTheme = false;

	@consume<State>({ context: stateContext, subscribe: true })
	@state()
	private _state!: State;

	@consume<HostIpc>({ context: ipcContext, subscribe: true })
	@state()
	private _ipc!: HostIpc;

	@state()
	private closed = false;

	override render(): unknown {
		const { welcomeOverlayCollapsed, walkthroughSupported, newInstall } = this._state;
		if (this.closed || welcomeOverlayCollapsed || walkthroughSupported || !newInstall) {
			return nothing;
		}

		return html`
			<div class="overlay">
				<gl-welcome-page
					.webroot=${this.webroot}
					.isLightTheme=${this.isLightTheme}
					closeable
					@close=${() => this.onClose()}
				></gl-welcome-app>
			</div>
		`;
	}

	private onClose() {
		this.closed = true;

		this._ipc.sendCommand(CollapseSectionCommand, {
			section: 'welcomeOverlay',
			collapsed: true,
		});
	}
}
