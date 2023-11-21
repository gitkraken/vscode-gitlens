import { css, html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { elementBase } from '../styles/lit/base.css';

@customElement('menu-label')
export class MenuLabel extends LitElement {
	static override styles = [
		elementBase,
		css`
			:host {
				display: block;
				text-transform: uppercase;
				font-size: 0.84em;
				line-height: 2.2rem;
				padding-left: 0.6rem;
				padding-right: 0.6rem;
				margin: 0px;
				color: var(--vscode-menu-foreground);
				opacity: 0.6;
				user-select: none;
			}
		`,
	];

	override render() {
		return html`<slot></slot>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'menu-label': MenuLabel;
	}
}
