import { css, html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { elementBase } from '../styles/lit/base.css.js';

@customElement('menu-label')
export class MenuLabel extends LitElement {
	static override styles = [
		elementBase,
		css`
			:host {
				display: block;
				padding-right: var(--gl-space-6);
				padding-left: var(--gl-space-6);
				margin: 0;
				font-size: 0.84em;
				line-height: 2.2rem;
				color: var(--vscode-menu-foreground);
				text-transform: uppercase;
				user-select: none;
				opacity: 0.6;
				-webkit-font-smoothing: auto;
			}
		`,
	];

	override render(): unknown {
		return html`<slot></slot>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'menu-label': MenuLabel;
	}
}
