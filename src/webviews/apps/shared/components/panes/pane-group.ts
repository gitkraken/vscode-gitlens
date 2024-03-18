import { css, html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('webview-pane-group')
export class WebviewPaneGroup extends LitElement {
	static override styles = css`
		:host {
			display: flex;
			box-sizing: border-box;
			flex-direction: column;
		}

		::slotted(webview-pane) {
			flex: none;
		}

		:host([flexible]) ::slotted(webview-pane[flexible][expanded]) {
			flex: 1;
		}
	`;

	override render() {
		return html`<slot></slot>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'webview-pane-group': WebviewPaneGroup;
	}
}
