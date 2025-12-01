import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { State } from '../../../home/protocol.js';
import { CollapseSectionCommand } from '../../../home/protocol.js';
import { ipcContext } from '../../shared/contexts/ipc.js';
import type { HostIpc } from '../../shared/ipc.js';
import '../../shared/components/button.js';
import { stateContext } from '../context.js';
import './welcome-page.js';

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
				--background-color: var(--vscode-sideBar-background);
				--shadow-color: var(--vscode-sideBar-foreground);
				--dialog-margin: 1rem;
				--scrollbar-width: 10px;
			}

			.overlay {
				display: block;
				position: fixed;
				inset: 0;
				overflow: auto;
				background-color: var(--background-color);
			}

			.close-button {
				position: fixed;
				top: 12px;
				right: 12px;
				z-index: 2;
			}

			gl-welcome-page {
				--page-background-color: var(--background-color);
				--page-margin-left: var(--dialog-margin);
				--page-margin-right: var(--dialog-margin);
			}

			gl-welcome-page::part(page) {
				padding: var(--dialog-margin);
				box-sizing: border-box;
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
				<div class="close-button">
					<gl-button appearance="toolbar" tooltip="Dismiss Welcome Overlay" @click=${() => this.onClose()}
						><code-icon icon="close"></code-icon
					></gl-button>
				</div>
				<gl-welcome-page
					.webroot=${this.webroot}
					.isLightTheme=${this.isLightTheme}
					closeable
					@close=${() => this.onClose()}
				></gl-welcome-page>
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
