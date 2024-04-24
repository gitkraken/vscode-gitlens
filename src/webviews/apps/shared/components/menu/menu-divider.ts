import { css, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { elementBase } from '../styles/lit/base.css';

@customElement('menu-divider')
export class MenuDivider extends LitElement {
	static override styles = [
		elementBase,
		css`
			:host {
				display: block;
				height: 0;
				margin: 0.6rem;
				border-top: 0.1rem solid var(--vscode-menu-separatorBackground);
			}
		`,
	];
}

declare global {
	interface HTMLElementTagNameMap {
		'menu-divider': MenuDivider;
	}
}
